import assert from 'assert'
import base64url from 'base64url'
import { OpenAPIV3_1 } from 'openapi-types'
import { StreamServer } from '@interledger/stream-receiver'
import { Logger } from 'pino'
import { AppContext } from '../../../app'
import { IAppConfig } from '../../../config/app'
import { IncomingPaymentService } from './service'
import { IncomingPayment, IncomingPaymentState } from './model'
import {
  errorToCode,
  errorToMessage,
  IncomingPaymentError,
  isIncomingPaymentError
} from './errors'
import { AmountJSON, parseAmount } from '../../amount'
import { createRequestValidators, RequestValidators } from '../../validator'

// Don't allow creating an incoming payment too far out. Incoming payments with no payments before they expire are cleaned up, since incoming payments creation is unauthenticated.
// TODO what is a good default value for this?
export const MAX_EXPIRY = 24 * 60 * 60 * 1000 // milliseconds

type Validators = RequestValidators<CreateBody, UpdateBody> & {
  update: RequestValidators<CreateBody, UpdateBody>['update']
}

interface ServiceDependencies {
  config: IAppConfig
  logger: Logger
  incomingPaymentService: IncomingPaymentService
  streamServer: StreamServer
  openApi: OpenAPIV3_1.Document
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

  const validators = createRequestValidators<CreateBody, UpdateBody>(
    deps.openApi,
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

  let incomingPayment: IncomingPayment | undefined
  try {
    incomingPayment = await deps.incomingPaymentService.get(ctx.params.id)
  } catch (err) {
    ctx.throw(500, 'Error trying to get incoming payment')
  }
  if (!incomingPayment) return ctx.throw(404)

  const body = incomingPaymentToBody(deps, incomingPayment)
  const { ilpAddress, sharedSecret } = getStreamCredentials(
    deps,
    incomingPayment
  )
  body['ilpAddress'] = ilpAddress
  body['sharedSecret'] = base64url(sharedSecret)
  ctx.body = body
}

export interface CreateBody {
  description?: string
  expiresAt?: string
  incomingAmount?: AmountJSON
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

  let expiresAt: Date | undefined
  if (body.expiresAt !== undefined) {
    expiresAt = new Date(body.expiresAt)
    if (Date.now() + MAX_EXPIRY < expiresAt.getTime())
      return ctx.throw(400, 'expiry too high')
  }

  const incomingPaymentOrError = await deps.incomingPaymentService.create({
    accountId: ctx.params.accountId,
    description: body.description,
    externalRef: body.externalRef,
    expiresAt,
    incomingAmount: body.incomingAmount && parseAmount(body.incomingAmount)
  })

  if (isIncomingPaymentError(incomingPaymentOrError)) {
    return ctx.throw(
      errorToCode[incomingPaymentOrError],
      errorToMessage[incomingPaymentOrError]
    )
  }

  ctx.status = 201
  const res = incomingPaymentToBody(deps, incomingPaymentOrError)
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

  let incomingPaymentOrError: IncomingPayment | IncomingPaymentError
  try {
    incomingPaymentOrError = await deps.incomingPaymentService.update({
      id: ctx.params.id,
      state: IncomingPaymentState.Completed
    })
  } catch (err) {
    ctx.throw(500, 'Error trying to update incoming payment')
  }

  if (isIncomingPaymentError(incomingPaymentOrError)) {
    return ctx.throw(
      errorToCode[incomingPaymentOrError],
      errorToMessage[incomingPaymentOrError]
    )
  }

  const res = incomingPaymentToBody(deps, incomingPaymentOrError)
  ctx.body = res
}

function incomingPaymentToBody(
  deps: ServiceDependencies,
  incomingPayment: IncomingPayment
) {
  const accountId = `${deps.config.publicHost}/${incomingPayment.accountId}`
  const body = {
    id: `${accountId}/incoming-payments/${incomingPayment.id}`,
    accountId,
    state: incomingPayment.state.toLowerCase(),
    receivedAmount: {
      value: incomingPayment.receivedAmount.value.toString(),
      assetCode: incomingPayment.receivedAmount.assetCode,
      assetScale: incomingPayment.receivedAmount.assetScale
    },
    expiresAt: incomingPayment.expiresAt.toISOString(),
    createdAt: incomingPayment.createdAt.toISOString(),
    updatedAt: incomingPayment.updatedAt.toISOString()
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
