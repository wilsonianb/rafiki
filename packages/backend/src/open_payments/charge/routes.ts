import assert from 'assert'
import { Logger } from 'pino'
import { CreateError, isCreateError } from '../../outgoing_payment/errors'
import { OutgoingPayment } from '../../outgoing_payment/model'
import { OutgoingPaymentService } from '../../outgoing_payment/service'
import { validateId } from '../../shared/utils'
import { AppContext } from '../../app'
import { IAppConfig } from '../../config/app'

interface ServiceDependencies {
  config: IAppConfig
  logger: Logger
  outgoingPaymentService: OutgoingPaymentService
}

export interface ChargeRoutes {
  get(ctx: AppContext): Promise<void>
  create(ctx: AppContext): Promise<void>
}

export function createChargeRoutes(deps_: ServiceDependencies): ChargeRoutes {
  const logger = deps_.logger.child({
    service: 'ChargeRoutes'
  })
  const deps = { ...deps_, logger }
  return {
    get: (ctx: AppContext) => getCharge(deps, ctx),
    create: (ctx: AppContext) => createCharge(deps, ctx)
  }
}

// Spec: https://docs.openpayments.dev/charges#get
async function getCharge(
  deps: ServiceDependencies,
  ctx: AppContext
): Promise<void> {
  const { chargeId } = ctx.params
  ctx.assert(validateId(chargeId), 400, 'invalid id')
  ctx.assert(ctx.accepts('application/json'), 406)

  const payment = await deps.outgoingPaymentService.get(chargeId)
  if (!payment || !payment.mandateId) {
    return ctx.throw(404)
  }
  assert.ok(payment.intent.invoiceUrl)

  ctx.body = paymentToBody(deps, payment)
}

// Spec: https://docs.openpayments.dev/charges#create
async function createCharge(
  deps: ServiceDependencies,
  ctx: AppContext
): Promise<void> {
  const { mandateId } = ctx.params
  ctx.assert(validateId(mandateId), 400, 'invalid mandate id')
  ctx.assert(ctx.accepts('application/json'), 406, 'must accept json')
  ctx.assert(
    ctx.get('Content-Type') === 'application/json',
    400,
    'must send json body'
  )

  const { body } = ctx.request
  if (typeof body !== 'object') return ctx.throw(400, 'json body required')
  if (!body.invoice || typeof body.invoice !== 'string')
    return ctx.throw(400, 'invalid invoice')

  const paymentOrErr = await deps.outgoingPaymentService.create({
    mandateId,
    invoiceUrl: body.invoice
  })

  if (isCreateError(paymentOrErr)) {
    return ctx.throw(400, errorToMessage[paymentOrErr])
  }

  ctx.status = 201
  const res = paymentToBody(deps, paymentOrErr)
  ctx.body = res
  ctx.set('Location', res.id)
}

function paymentToBody(deps: ServiceDependencies, payment: OutgoingPayment) {
  const location = `${deps.config.publicHost}/charges/${payment.id}`
  return {
    id: location,
    mandate: `${deps.config.publicHost}/mandates/${payment.mandateId}`,
    invoice: payment.intent.invoiceUrl,
    status: payment.state
  }
}

const errorToMessage: {
  [key in CreateError]: string
} = {
  [CreateError.InvalidMandate]: 'invalid mandate',
  [CreateError.UnknownAccount]: 'unknown account',
  [CreateError.UnknownMandate]: 'unknown mandate'
}
