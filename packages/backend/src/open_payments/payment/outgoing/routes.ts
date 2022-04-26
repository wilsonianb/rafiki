import { Logger } from 'pino'
import { validateId } from '../../../shared/utils'
import { AppContext } from '../../../app'
import { IAppConfig } from '../../../config/app'
import { OutgoingPaymentService } from './service'
import { isOutgoingPaymentError, errorToCode, errorToMessage } from './errors'
import { OutgoingPayment, OutgoingPaymentState } from './model'
import { QuoteService } from '../../quote/service'
import {
  isQuoteError,
  errorToCode as quoteErrorToCode,
  errorToMessage as quoteErrorToMessage
} from '../../quote/errors'
import { Amount } from '../../amount'

interface ServiceDependencies {
  config: IAppConfig
  logger: Logger
  outgoingPaymentService: OutgoingPaymentService
  quoteService: QuoteService
}

export interface OutgoingPaymentRoutes {
  get(ctx: AppContext): Promise<void>
  create(ctx: AppContext): Promise<void>
}

export function createOutgoingPaymentRoutes(
  deps_: ServiceDependencies
): OutgoingPaymentRoutes {
  const logger = deps_.logger.child({
    service: 'OutgoingPaymentRoutes'
  })
  const deps = { ...deps_, logger }
  return {
    get: (ctx: AppContext) => getOutgoingPayment(deps, ctx),
    create: (ctx: AppContext) => createOutgoingPayment(deps, ctx)
  }
}

async function getOutgoingPayment(
  deps: ServiceDependencies,
  ctx: AppContext
): Promise<void> {
  const { outgoingPaymentId: outgoingPaymentId } = ctx.params
  ctx.assert(validateId(outgoingPaymentId), 400, 'invalid id')
  const acceptJSON = ctx.accepts('application/json')
  ctx.assert(acceptJSON, 406)

  const outgoingPayment = await deps.outgoingPaymentService.get(
    outgoingPaymentId
  )
  if (!outgoingPayment) return ctx.throw(404)

  const body = outgoingPaymentToBody(deps, outgoingPayment)
  ctx.body = body
}

async function createOutgoingPayment(
  deps: ServiceDependencies,
  ctx: AppContext
): Promise<void> {
  const { accountId } = ctx.params
  ctx.assert(validateId(accountId), 400, 'invalid account id')
  ctx.assert(ctx.accepts('application/json'), 406, 'must accept json')
  ctx.assert(
    ctx.get('Content-Type') === 'application/json',
    400,
    'must send json body'
  )

  const { body } = ctx.request
  if (typeof body !== 'object') return ctx.throw(400, 'json body required')

  if (
    body.receivingAccount !== undefined &&
    typeof body.receivingAccount !== 'string'
  )
    return ctx.throw(400, 'invalid receivingAccount')
  let sendAmount: Amount | undefined
  if (body.sendAmount) {
    try {
      sendAmount = parseAmount(body.sendAmount)
    } catch (_) {
      return ctx.throw(400, 'invalid sendAmount')
    }
  }
  let receiveAmount: Amount | undefined
  if (body.receiveAmount) {
    try {
      receiveAmount = parseAmount(body.receiveAmount)
    } catch (_) {
      return ctx.throw(400, 'invalid receiveAmount')
    }
  }
  if (
    body.receivingPayment !== undefined &&
    typeof body.receivingPayment !== 'string'
  )
    return ctx.throw(400, 'invalid receivingPayment')

  if (body.description !== undefined && typeof body.description !== 'string')
    return ctx.throw(400, 'invalid description')
  if (body.externalRef !== undefined && typeof body.externalRef !== 'string')
    return ctx.throw(400, 'invalid externalRef')

  let quoteId: string
  if (body.quoteId) {
    if (typeof body.quoteId !== 'string')
      return ctx.throw(400, 'invalid quoteId')
    if (body.receivingAccount) return ctx.throw(400, 'invalid receivingAccount')
    if (body.receivingPayment) return ctx.throw(400, 'invalid receivingPayment')
    if (body.sendAmount) return ctx.throw(400, 'invalid sendAmount')
    if (body.receiveAmount) return ctx.throw(400, 'invalid receiveAmount')
    quoteId = body.quoteId
  } else {
    const quoteOrErr = await deps.quoteService.create({
      accountId,
      receivingAccount: body.receivingAccount,
      sendAmount,
      receiveAmount,
      receivingPayment: body.receivingPayment
    })
    if (isQuoteError(quoteOrErr)) {
      return ctx.throw(
        quoteErrorToCode[quoteOrErr],
        quoteErrorToMessage[quoteOrErr]
      )
    }
    quoteId = quoteOrErr.id
  }

  const paymentOrErr = await deps.outgoingPaymentService.create({
    accountId,
    quoteId,
    description: body.description,
    externalRef: body.externalRef
  })

  if (isOutgoingPaymentError(paymentOrErr)) {
    return ctx.throw(errorToCode[paymentOrErr], errorToMessage[paymentOrErr])
  }

  ctx.status = 201
  const res = outgoingPaymentToBody(deps, paymentOrErr)
  ctx.body = res
}

function outgoingPaymentToBody(
  deps: ServiceDependencies,
  outgoingPayment: OutgoingPayment
) {
  const accountId = `${deps.config.publicHost}/${outgoingPayment.accountId}`
  return {
    id: `${accountId}/outgoing-payments/${outgoingPayment.id}`,
    accountId,
    state: [
      OutgoingPaymentState.Funding,
      OutgoingPaymentState.Sending
    ].includes(outgoingPayment.state)
      ? 'processing'
      : outgoingPayment.state.toLowerCase(),
    receivingPayment: outgoingPayment.receivingPayment,
    sendAmount: {
      ...outgoingPayment.sendAmount,
      value: outgoingPayment.sendAmount.value.toString()
    },
    receiveAmount: {
      ...outgoingPayment.receiveAmount,
      value: outgoingPayment.receiveAmount.value.toString()
    },
    description: outgoingPayment.description ?? undefined,
    externalRef: outgoingPayment.externalRef ?? undefined
  }
}

function parseAmount(amount: unknown): Amount {
  if (
    typeof amount !== 'object' ||
    amount === null ||
    (amount['assetCode'] && typeof amount['assetCode'] !== 'string') ||
    (amount['assetScale'] !== undefined &&
      typeof amount['assetScale'] !== 'number')
  ) {
    throw new Error('invalid amount')
  }
  return {
    value: BigInt(amount['value']),
    assetCode: amount['assetCode'],
    assetScale: amount['assetScale']
  }
}
