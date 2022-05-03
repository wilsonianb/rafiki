import assert from 'assert'
import base64url from 'base64url'
import { StreamServer } from '@interledger/stream-receiver'
import { Logger } from 'pino'
import { AppContext } from '../../../app'
import { IAppConfig } from '../../../config/app'
import { AccountingService } from '../../../accounting/service'
import { IncomingPaymentService } from './service'
import { IncomingPayment, IncomingPaymentState } from './model'
import { errorToCode, errorToMessage, isIncomingPaymentError } from './errors'
import { Amount } from '../amount'
import { ValidatorService, PathValidators } from '../../validator'

type Validators = PathValidators<CreateBody, UpdateBody> & {
  update: PathValidators<CreateBody, UpdateBody>['update']
}

// Don't allow creating an incoming payment too far out. Incoming payments with no payments before they expire are cleaned up, since incoming payments creation is unauthenticated.
// TODO what is a good default value for this?
export const MAX_EXPIRY = 24 * 60 * 60 * 1000 // milliseconds

interface ServiceDependencies {
  config: IAppConfig
  logger: Logger
  accountingService: AccountingService
  incomingPaymentService: IncomingPaymentService
  streamServer: StreamServer
  validatorService: ValidatorService
}

export interface IncomingPaymentRoutes {
  get(ctx: AppContext): Promise<void>
  create(ctx: AppContext): Promise<void>
  update(ctx: AppContext): Promise<void>
}

export function createIncomingPaymentRoutes(
  deps_: ServiceDependencies
): IncomingPaymentRoutes {
  const logger = deps_.logger.child({
    service: 'IncomingPaymentRoutes'
  })
  const deps = { ...deps_, logger }

  const validators = deps.validatorService.create<CreateBody, UpdateBody>(
    '/incoming-payments'
  )
  assert.ok(validators.update)
  return {
    get: (ctx: AppContext) => getIncomingPayment(deps, ctx, validators.read),
    create: (ctx: AppContext) =>
      createIncomingPayment(deps, ctx, validators.create),
    update: (ctx: AppContext) =>
      updateIncomingPayment(deps, ctx, validators.update)
  }
}

async function getIncomingPayment(
  deps: ServiceDependencies,
  ctx: AppContext,
  validate: Validators['read']
): Promise<void> {
  if (!validate(ctx)) {
    return ctx.throw(400)
  }

  const incomingPayment = await deps.incomingPaymentService.get(ctx.params.id)
  if (!incomingPayment) return ctx.throw(404)

  const amountReceived = await deps.accountingService.getTotalReceived(
    incomingPayment.id
  )
  if (amountReceived === undefined) {
    deps.logger.error(
      { incomingPayment: incomingPayment.id },
      'account not found'
    )
    return ctx.throw(500)
  }

  const body = incomingPaymentToBody(deps, incomingPayment, amountReceived)
  const { ilpAddress, sharedSecret } = getStreamCredentials(
    deps,
    incomingPayment
  )
  body['ilpAddress'] = ilpAddress
  body['sharedSecret'] = base64url(sharedSecret)
  ctx.body = body
}

export interface AmountBody {
  value: string
  assetCode: string
  assetScale: number
}

export interface CreateBody {
  description?: string
  expiresAt?: string
  incomingAmount?: AmountBody
  externalRef?: string
}

async function createIncomingPayment(
  deps: ServiceDependencies,
  ctx: AppContext,
  validate: Validators['create']
): Promise<void> {
  if (!validate(ctx)) {
    return ctx.throw(400)
  }

  const { body } = ctx.request

  const incomingPaymentOrError = await deps.incomingPaymentService.create({
    accountId: ctx.params.accountId,
    description: body.description,
    externalRef: body.externalRef,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    incomingAmount: parseAmount(body.incomingAmount)
  })

  if (isIncomingPaymentError(incomingPaymentOrError)) {
    return ctx.throw(
      errorToCode[incomingPaymentOrError],
      errorToMessage[incomingPaymentOrError]
    )
  }

  ctx.status = 201
  const res = incomingPaymentToBody(deps, incomingPaymentOrError, BigInt(0))
  const { ilpAddress, sharedSecret } = getStreamCredentials(
    deps,
    incomingPaymentOrError
  )
  res['ilpAddress'] = ilpAddress
  res['sharedSecret'] = base64url(sharedSecret)
  ctx.body = res
}

export interface UpdateBody {
  state: string
}

async function updateIncomingPayment(
  deps: ServiceDependencies,
  ctx: AppContext,
  validate: Validators['update']
): Promise<void> {
  if (!validate || !validate(ctx)) {
    return ctx.throw(400)
  }

  const incomingPaymentOrError = await deps.incomingPaymentService.update({
    id: ctx.params.id,
    state: IncomingPaymentState.Completed
  })

  if (isIncomingPaymentError(incomingPaymentOrError)) {
    return ctx.throw(
      errorToCode[incomingPaymentOrError],
      errorToMessage[incomingPaymentOrError]
    )
  }

  const amountReceived = await deps.accountingService.getTotalReceived(
    incomingPaymentOrError.id
  )
  if (amountReceived === undefined) {
    deps.logger.error(
      { incomingPayment: incomingPaymentOrError.id },
      'account not found'
    )
    return ctx.throw(500)
  }

  const res = incomingPaymentToBody(
    deps,
    incomingPaymentOrError,
    amountReceived
  )
  ctx.body = res
}

function incomingPaymentToBody(
  deps: ServiceDependencies,
  incomingPayment: IncomingPayment,
  received: bigint
) {
  const accountId = `${deps.config.publicHost}/${incomingPayment.accountId}`
  const body = {
    id: `${accountId}/incoming-payments/${incomingPayment.id}`,
    accountId,
    state: incomingPayment.state.toLowerCase(),
    receivedAmount: {
      value: received.toString(),
      assetCode: incomingPayment.asset.code,
      assetScale: incomingPayment.asset.scale
    },
    expiresAt: incomingPayment.expiresAt.toISOString()
  }

  if (incomingPayment.incomingAmount) {
    body['incomingAmount'] = {
      value: incomingPayment.incomingAmount.value.toString(),
      assetCode: incomingPayment.incomingAmount.assetCode,
      assetScale: incomingPayment.incomingAmount.assetScale
    }
  }
  if (incomingPayment.description)
    body['description'] = incomingPayment.description
  if (incomingPayment.externalRef)
    body['externalRef'] = incomingPayment.externalRef
  return body
}

function parseAmount(amount: AmountBody | undefined): Amount | undefined {
  if (amount === undefined) return amount
  return {
    value: BigInt(amount['value']),
    assetCode: amount['assetCode'],
    assetScale: amount['assetScale']
  }
}

function getStreamCredentials(
  deps: ServiceDependencies,
  incomingPayment: IncomingPayment
) {
  return deps.streamServer.generateCredentials({
    paymentTag: incomingPayment.id,
    asset: {
      code: incomingPayment.asset.code,
      scale: incomingPayment.asset.scale
    }
  })
}
