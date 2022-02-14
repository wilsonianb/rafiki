import { join } from 'path'
import { Server } from 'http'
import { EventEmitter } from 'events'

import { IocContract } from '@adonisjs/fold'
import Knex from 'knex'
import Koa, { DefaultState } from 'koa'
import bodyParser from 'koa-bodyparser'
import { Logger } from 'pino'
import Router from '@koa/router'
import { ApolloServer } from 'apollo-server-koa'

import { IAppConfig } from './config/app'
import { MessageProducer } from './messaging/messageProducer'
import { WorkerUtils } from 'graphile-worker'
import {
  addResolversToSchema,
  GraphQLFileLoader,
  loadSchemaSync
} from 'graphql-tools'
import { resolvers } from './graphql/resolvers'
import { HttpTokenService } from './httpToken/service'
import { AssetService } from './asset/service'
import { AccountingService } from './accounting/service'
import { PeerService } from './peer/service'
import { AccountService } from './open_payments/account/service'
import { RatesService } from './rates/service'
import { SPSPRoutes } from './spsp/routes'
import { InvoiceRoutes } from './open_payments/invoice/routes'
import { AccountRoutes } from './open_payments/account/routes'
import { InvoiceService } from './open_payments/invoice/service'
import { StreamServer } from '@interledger/stream-receiver'
import { WebhookService } from './webhook/service'
import { OutgoingPaymentService } from './outgoing_payment/service'
import { IlpPlugin, IlpPluginOptions } from './outgoing_payment/ilp_plugin'
import { ApiKeyService } from './apiKey/service'
import { SessionService } from './session/service'
import { addDirectivesToSchema } from './graphql/directives'
import { Session } from './session/util'

export interface AppContextData {
  logger: Logger
  closeEmitter: EventEmitter
  container: AppContainer
  // Set by @koa/router.
  params: { [key: string]: string }
}

export interface ApolloContext {
  messageProducer: MessageProducer
  container: IocContract<AppServices>
  logger: Logger
  admin: boolean
  session: Session | undefined
}
export type AppContext = Koa.ParameterizedContext<DefaultState, AppContextData>

export interface AppServices {
  logger: Promise<Logger>
  messageProducer: Promise<MessageProducer>
  knex: Promise<Knex>
  closeEmitter: Promise<EventEmitter>
  config: Promise<IAppConfig>
  workerUtils: Promise<WorkerUtils>
  httpTokenService: Promise<HttpTokenService>
  assetService: Promise<AssetService>
  accountingService: Promise<AccountingService>
  peerService: Promise<PeerService>
  accountService: Promise<AccountService>
  spspRoutes: Promise<SPSPRoutes>
  invoiceRoutes: Promise<InvoiceRoutes>
  accountRoutes: Promise<AccountRoutes>
  invoiceService: Promise<InvoiceService>
  streamServer: Promise<StreamServer>
  webhookService: Promise<WebhookService>
  outgoingPaymentService: Promise<OutgoingPaymentService>
  makeIlpPlugin: Promise<(options: IlpPluginOptions) => IlpPlugin>
  ratesService: Promise<RatesService>
  apiKeyService: Promise<ApiKeyService>
  sessionService: Promise<SessionService>
}

export type AppContainer = IocContract<AppServices>

export class App {
  private koa!: Koa<DefaultState, AppContext>
  private publicRouter!: Router<DefaultState, AppContext>
  private server!: Server
  public apolloServer!: ApolloServer
  public closeEmitter!: EventEmitter
  public isShuttingDown = false
  private logger!: Logger
  private messageProducer!: MessageProducer
  private config!: IAppConfig
  private outgoingPaymentTimer!: NodeJS.Timer
  private deactivateInvoiceTimer!: NodeJS.Timer

  public constructor(private container: IocContract<AppServices>) {}

  /**
   * The boot function exists because the functions that we register on the container with the `bind` method are async.
   * We then need to await this function when we call use - which can't be done in the constructor. This is a first pass to
   * get the container working. We can refactor this in future. Perhaps don't use private members and just pass around the container?
   * Or provide start / shutdown methods on the services in the container?
   */
  public async boot(): Promise<void> {
    this.config = await this.container.use('config')
    this.koa = new Koa<DefaultState, AppContext>()
    this.closeEmitter = await this.container.use('closeEmitter')
    this.logger = await this.container.use('logger')
    this.koa.context.container = this.container
    this.koa.context.logger = await this.container.use('logger')
    this.koa.context.closeEmitter = await this.container.use('closeEmitter')
    this.messageProducer = await this.container.use('messageProducer')
    this.publicRouter = new Router()

    this.koa.use(
      async (
        ctx: {
          status: number
          set: (arg0: string, arg1: string) => void
          body: string
        },
        next: () => void | PromiseLike<void>
      ): Promise<void> => {
        if (this.isShuttingDown) {
          ctx.status = 503
          ctx.set('Connection', 'close')
          ctx.body = 'Server is in the process of restarting'
        } else {
          return next()
        }
      }
    )
    await this._setupRoutes()
    this._setupGraphql()

    // Workers are in the way during tests.
    if (this.config.env !== 'test') {
      for (let i = 0; i < this.config.outgoingPaymentWorkers; i++) {
        process.nextTick(() => this.processOutgoingPayment())
      }
      for (let i = 0; i < this.config.invoiceWorkers; i++) {
        process.nextTick(() => this.processInvoice())
      }
      for (let i = 0; i < this.config.webhookWorkers; i++) {
        process.nextTick(() => this.processWebhook())
      }
    }
  }

  public listen(port: number | string): void {
    this.server = this.koa.listen(port)
  }

  public async shutdown(): Promise<void> {
    return new Promise((resolve): void => {
      if (this.server) {
        this.isShuttingDown = true
        this.closeEmitter.emit('shutdown')
        this.server.close((): void => {
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  public getPort(): number {
    const address = this.server?.address()
    if (address && !(typeof address == 'string')) {
      return address.port
    }
    return 0
  }

  private _setupGraphql(): void {
    // Load schema from the file
    const schema = loadSchemaSync(join(__dirname, './graphql/schema.graphql'), {
      loaders: [new GraphQLFileLoader()]
    })

    // Add resolvers to the schema
    const schemaWithResolvers = addResolversToSchema({
      schema,
      resolvers
    })

    let schemaWithDirectives = schemaWithResolvers
    // Add directives to schema
    if (this.config.env !== 'test') {
      schemaWithDirectives = addDirectivesToSchema(schemaWithResolvers)
    }

    // Setup Apollo on graphql endpoint
    this.apolloServer = new ApolloServer({
      schema: schemaWithDirectives,
      context: async ({ ctx }: Koa.Context): Promise<ApolloContext> => {
        const admin = this._isAdmin(ctx)
        const session = await this._getSession(ctx)
        return {
          messageProducer: this.messageProducer,
          container: this.container,
          logger: await this.container.use('logger'),
          admin,
          session
        }
      }
    })

    this.koa.use(this.apolloServer.getMiddleware())
  }

  private _isAdmin(ctx: Koa.Context): boolean {
    return ctx.request.header['x-api-key'] == this.config.adminKey
  }

  private async _getSession(ctx: Koa.Context): Promise<Session | undefined> {
    const key = ctx.request.header.authorization || ''
    if (key && key.length) {
      const sessionService = await this.container.use('sessionService')
      return await sessionService.get(key)
    } else {
      return undefined
    }
  }

  private async _setupRoutes(): Promise<void> {
    this.publicRouter.use(bodyParser())
    this.publicRouter.get('/healthz', (ctx: AppContext): void => {
      ctx.status = 200
    })

    const spspRoutes = await this.container.use('spspRoutes')
    const accountRoutes = await this.container.use('accountRoutes')
    const invoiceRoutes = await this.container.use('invoiceRoutes')
    this.publicRouter.get(
      '/pay/:accountId',
      async (ctx: AppContext): Promise<void> => {
        // Fall back to legacy protocols if client doesn't support Open Payments.
        if (ctx.accepts('application/json')) await accountRoutes.get(ctx)
        //else if (ctx.accepts('application/ilp-stream+json')) // TODO https://docs.openpayments.dev/accounts#payment-details
        else if (ctx.accepts('application/spsp4+json'))
          await spspRoutes.get(ctx)
        else ctx.throw(406, 'no accepted Content-Type available')
      }
    )

    this.publicRouter.get('/invoices/:invoiceId', invoiceRoutes.get)
    this.publicRouter.post('/pay/:accountId/invoices', invoiceRoutes.create)

    this.koa.use(this.publicRouter.middleware())
  }

  private async processOutgoingPayment(): Promise<void> {
    if (this.isShuttingDown) return
    const outgoingPaymentService = await this.container.use(
      'outgoingPaymentService'
    )
    return outgoingPaymentService
      .processNext()
      .catch((err) => {
        this.logger.warn({ error: err.message }, 'processOutgoingPayment error')
        return true
      })
      .then((hasMoreWork) => {
        if (hasMoreWork) process.nextTick(() => this.processOutgoingPayment())
        else
          setTimeout(
            () => this.processOutgoingPayment(),
            this.config.outgoingPaymentWorkerIdle
          ).unref()
      })
  }

  private async processInvoice(): Promise<void> {
    const invoiceService = await this.container.use('invoiceService')
    return invoiceService
      .processNext()
      .catch((err) => {
        this.logger.warn({ error: err.message }, 'processInvoice error')
        return true
      })
      .then((hasMoreWork) => {
        if (hasMoreWork) process.nextTick(() => this.processInvoice())
        else
          setTimeout(
            () => this.processInvoice(),
            this.config.invoiceWorkerIdle
          ).unref()
      })
  }

  private async processWebhook(): Promise<void> {
    const webhookService = await this.container.use('webhookService')
    return webhookService
      .processNext()
      .catch((err) => {
        this.logger.warn({ error: err.message }, 'processWebhook error')
        return true
      })
      .then((hasMoreWork) => {
        if (hasMoreWork) process.nextTick(() => this.processWebhook())
        else
          setTimeout(
            () => this.processWebhook(),
            this.config.webhookWorkerIdle
          ).unref()
      })
  }
}
