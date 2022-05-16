import assert from 'assert'
import { Logger } from 'pino'
import { AppContext } from '../../app'
import { IAppConfig } from '../../config/app'
import { QuoteService } from './service'
import { isQuoteError, errorToCode, errorToMessage } from './errors'
import { Quote } from './model'
import { AmountJSON, parseAmount } from '../amount'
import { OpenAPI, HttpMethod } from '../../openapi'
import {
  createRequestValidator,
  ReadContext,
  CreateContext,
  RequestValidator
} from '../../openapi/validator'

export const COLLECTION_PATH = '/{accountId}/quotes'
export const RESOURCE_PATH = `${COLLECTION_PATH}/{id}`

interface ServiceDependencies {
  config: IAppConfig
  logger: Logger
  quoteService: QuoteService
  openApi: OpenAPI
}

export interface QuoteRoutes {
  get(ctx: AppContext): Promise<void>
  create(ctx: AppContext): Promise<void>
  collectionPath: string
  resourcePath: string
}

export function createQuoteRoutes(deps_: ServiceDependencies): QuoteRoutes {
  const logger = deps_.logger.child({
    service: 'QuoteRoutes'
  })
  const deps = { ...deps_, logger }
  assert.ok(deps.openApi.hasPath(RESOURCE_PATH))
  assert.ok(deps.openApi.hasPath(COLLECTION_PATH))
  return {
    get: (ctx: AppContext) =>
      getQuote(
        deps,
        ctx,
        createRequestValidator<ReadContext>({
          path: deps.openApi.paths[RESOURCE_PATH],
          method: HttpMethod.GET
        })
      ),
    create: (ctx: AppContext) =>
      createQuote(
        deps,
        ctx,
        createRequestValidator<CreateContext<CreateBody>>({
          path: deps.openApi.paths[COLLECTION_PATH],
          method: HttpMethod.POST
        })
      ),
    collectionPath: COLLECTION_PATH,
    resourcePath: RESOURCE_PATH
  }
}

async function getQuote(
  deps: ServiceDependencies,
  ctx: AppContext,
  validate: RequestValidator<ReadContext>
): Promise<void> {
  if (!validate(ctx)) {
    return ctx.throw(400)
  }
  const quote = await deps.quoteService.get(ctx.params.id)
  if (!quote) return ctx.throw(404)

  const body = quoteToBody(deps, quote)
  ctx.body = body
}

export interface CreateBody {
  receivingAccount?: string
  receivingPayment?: string
  sendAmount?: AmountJSON
  receiveAmount?: AmountJSON
}

async function createQuote(
  deps: ServiceDependencies,
  ctx: AppContext,
  validate: RequestValidator<CreateContext<CreateBody>>
): Promise<void> {
  if (!validate(ctx)) {
    return ctx.throw(400)
  }
  const { body } = ctx.request
  try {
    const quoteOrErr = await deps.quoteService.create({
      accountId: ctx.params.accountId,
      receivingAccount: body.receivingAccount,
      sendAmount: body.sendAmount && parseAmount(body.sendAmount),
      receiveAmount: body.receiveAmount && parseAmount(body.receiveAmount),
      receivingPayment: body.receivingPayment
    })

    if (isQuoteError(quoteOrErr)) {
      throw quoteOrErr
    }

    ctx.status = 201
    const res = quoteToBody(deps, quoteOrErr)
    ctx.body = res
  } catch (err) {
    if (isQuoteError(err)) {
      return ctx.throw(errorToCode[err], errorToMessage[err])
    }
    deps.logger.debug({ error: err.message })
    ctx.throw(500, 'Error trying to create quote')
  }
}

function quoteToBody(deps: ServiceDependencies, quote: Quote) {
  const accountId = `${deps.config.publicHost}/${quote.accountId}`
  return {
    ...quote.toJSON(),
    id: `${accountId}/quotes/${quote.id}`,
    accountId
  }
}
