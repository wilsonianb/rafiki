import assert from 'assert'
import base64url from 'base64url'
import { StreamServer } from '@interledger/stream-receiver'
import { Logger } from 'pino'
import { validateId } from '../../../shared/utils'
import { AppContext } from '../../../app'
import { IAppConfig } from '../../../config/app'
import { AccountingService } from '../../../accounting/service'
import { IncomingPaymentService } from './service'
import { IncomingPayment, IncomingPaymentState } from './model'
import { errorToCode, errorToMessage, isIncomingPaymentError } from './errors'
import { Amount } from '../amount'
import Ajv2020, { ValidateFunction } from 'ajv/dist/2020'
import { OpenAPIV3_1 } from 'openapi-types'

// Don't allow creating an incoming payment too far out. Incoming payments with no payments before they expire are cleaned up, since incoming payments creation is unauthenticated.
// TODO what is a good default value for this?
export const MAX_EXPIRY = 24 * 60 * 60 * 1000 // milliseconds

interface ServiceDependencies {
  config: IAppConfig
  logger: Logger
  ajv: Ajv2020
  openPaymentsSpec: OpenAPIV3_1.Document
  accountingService: AccountingService
  incomingPaymentService: IncomingPaymentService
  streamServer: StreamServer
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

  assert.ok(
    deps.openPaymentsSpec.paths?.['/incoming-payments']?.post?.requestBody
  )
  const createBody = deps.openPaymentsSpec.paths['/incoming-payments'].post
    .requestBody as OpenAPIV3_1.RequestBodyObject
  assert.ok(createBody.content['application/json'].schema)

  const validateCreate = deps.ajv.compile<CreateIncomingPaymentBody>(
    createBody.content['application/json'].schema
  )

  return {
    get: (ctx: AppContext) => getIncomingPayment(deps, ctx),
    create: (ctx: AppContext) =>
      createIncomingPayment(deps, ctx, validateCreate),
    update: (ctx: AppContext) => updateIncomingPayment(deps, ctx)
  }
}

async function getIncomingPayment(
  deps: ServiceDependencies,
  ctx: AppContext
): Promise<void> {
  const { incomingPaymentId } = ctx.params
  ctx.assert(validateId(incomingPaymentId), 400, 'invalid id')
  const acceptJSON = ctx.accepts('application/json')
  ctx.assert(acceptJSON, 406, 'must accept json')

  const incomingPayment = await deps.incomingPaymentService.get(
    incomingPaymentId
  )
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

export interface CreateIncomingPaymentBody {
  description?: string
  expiresAt?: string
  incomingAmount?: AmountBody
  externalRef?: string
}

async function createIncomingPayment(
  deps: ServiceDependencies,
  ctx: AppContext,
  validate: ValidateFunction<CreateIncomingPaymentBody>
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

  if (!validate(body)) {
    const error = validate.errors?.[0]
    ctx.throw(
      400,
      `${error?.instancePath.slice(1).replace('/', '.')} ${error?.message}`
    )
  }

  const incomingPaymentOrError = await deps.incomingPaymentService.create({
    accountId,
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

async function updateIncomingPayment(
  deps: ServiceDependencies,
  ctx: AppContext
): Promise<void> {
  const { incomingPaymentId } = ctx.params
  ctx.assert(validateId(incomingPaymentId), 400, 'invalid id')
  const acceptJSON = ctx.accepts('application/json')
  ctx.assert(acceptJSON, 406, 'must accept json')
  ctx.assert(
    ctx.get('Content-Type') === 'application/json',
    400,
    'must send json body'
  )

  const { body } = ctx.request
  if (typeof body !== 'object') return ctx.throw(400, 'json body required')
  if (typeof body['state'] !== 'string') return ctx.throw(400, 'invalid state')
  const state = Object.values(IncomingPaymentState).find(
    (name) => name.toLowerCase() === body.state
  )
  if (state === undefined) return ctx.throw(400, 'invalid state')

  const incomingPaymentOrError = await deps.incomingPaymentService.update({
    id: incomingPaymentId,
    state
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
