import { Logger } from 'pino'
import { OpenAPIV3_1 } from 'openapi-types'
import { AppContext } from '../../../app'
import { IAppConfig } from '../../../config/app'
import { OutgoingPaymentService } from './service'
import { isOutgoingPaymentError, errorToCode, errorToMessage } from './errors'
import { OutgoingPayment, OutgoingPaymentState } from './model'
import { createRequestValidators, RequestValidators } from '../../validator'

type Validators = RequestValidators<CreateBody>

interface ServiceDependencies {
  config: IAppConfig
  logger: Logger
  outgoingPaymentService: OutgoingPaymentService
  openApi: OpenAPIV3_1.Document
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
  const validators = createRequestValidators<CreateBody>(
    deps.openApi,
    '/outgoing-payments'
  )
  return {
    get: (ctx: AppContext) => getOutgoingPayment(deps, ctx, validators.read),
    create: (ctx: AppContext) =>
      createOutgoingPayment(deps, ctx, validators.create)
  }
}

async function getOutgoingPayment(
  deps: ServiceDependencies,
  ctx: AppContext,
  validate: Validators['read']
): Promise<void> {
  if (!validate(ctx)) {
    return ctx.throw(400)
  }

  let outgoingPayment: OutgoingPayment | undefined
  try {
    outgoingPayment = await deps.outgoingPaymentService.get(ctx.params.id)
  } catch (_) {
    ctx.throw(500, 'Error trying to get outgoing payment')
  }
  if (!outgoingPayment) return ctx.throw(404)

  const body = outgoingPaymentToBody(deps, outgoingPayment)
  ctx.body = body
}

export interface CreateBody {
  quoteId: string
  description?: string
  externalRef?: string
}

async function createOutgoingPayment(
  deps: ServiceDependencies,
  ctx: AppContext,
  validate: Validators['create']
): Promise<void> {
  if (!validate(ctx)) {
    return ctx.throw(400)
  }
  const { body } = ctx.request

  const quoteUrlParts = body.quoteId.split('/')
  const quoteId = quoteUrlParts.pop() || quoteUrlParts.pop() // handle trailing slash
  if (!quoteId) {
    return ctx.throw(400, 'invalid quoteId')
  }

  const paymentOrErr = await deps.outgoingPaymentService.create({
    accountId: ctx.params.accountId,
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
    sentAmount: {
      ...outgoingPayment.sentAmount,
      value: outgoingPayment.sentAmount.value.toString()
    },
    receiveAmount: {
      ...outgoingPayment.receiveAmount,
      value: outgoingPayment.receiveAmount.value.toString()
    },
    description: outgoingPayment.description ?? undefined,
    externalRef: outgoingPayment.externalRef ?? undefined,
    createdAt: outgoingPayment.createdAt.toISOString(),
    updatedAt: outgoingPayment.updatedAt.toISOString()
  }
}
