import { Logger } from 'pino'
import { OpenAPIV3_1 } from 'openapi-types'
import { AppContext } from '../../app'
import { IAppConfig } from '../../config/app'
import { QuoteService } from './service'
import { isQuoteError, errorToCode, errorToMessage } from './errors'
import { Quote } from './model'
import { AmountJSON, parseAmount } from '../amount'
import { createRequestValidators, RequestValidators } from '../validator'

type Validators = RequestValidators<CreateBody>

interface ServiceDependencies {
  config: IAppConfig
  logger: Logger
  quoteService: QuoteService
  openApi: OpenAPIV3_1.Document
}

export interface QuoteRoutes {
  get(ctx: AppContext): Promise<void>
  create(ctx: AppContext): Promise<void>
}

export function createQuoteRoutes(deps_: ServiceDependencies): QuoteRoutes {
  const logger = deps_.logger.child({
    service: 'QuoteRoutes'
  })
  const deps = { ...deps_, logger }
  const validators = createRequestValidators<CreateBody>(
    deps.openApi,
    '/quotes'
  )
  return {
    get: (ctx: AppContext) => getQuote(deps, ctx, validators.read),
    create: (ctx: AppContext) => createQuote(deps, ctx, validators.create)
  }
}

async function getQuote(
  deps: ServiceDependencies,
  ctx: AppContext,
  validate: Validators['read']
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
  validate: Validators['create']
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
