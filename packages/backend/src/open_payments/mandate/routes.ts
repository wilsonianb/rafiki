import { Logger } from 'pino'
import { validateId } from '../../shared/utils'
import { AppContext } from '../../app'
import { IAppConfig } from '../../config/app'
import { MandateService } from './service'
import { CreateError, isCreateError } from './errors'
import { Mandate } from './model'

interface ServiceDependencies {
  config: IAppConfig
  logger: Logger
  mandateService: MandateService
}

export interface MandateRoutes {
  get(ctx: AppContext): Promise<void>
  create(ctx: AppContext): Promise<void>
}

export function createMandateRoutes(deps_: ServiceDependencies): MandateRoutes {
  const logger = deps_.logger.child({
    service: 'MandateRoutes'
  })
  const deps = { ...deps_, logger }
  return {
    get: (ctx: AppContext) => getMandate(deps, ctx),
    create: (ctx: AppContext) => createMandate(deps, ctx)
  }
}

// Spec: https://docs.openpayments.dev/mandates#get
async function getMandate(
  deps: ServiceDependencies,
  ctx: AppContext
): Promise<void> {
  const { mandateId } = ctx.params
  ctx.assert(validateId(mandateId), 400, 'invalid id')
  ctx.assert(ctx.accepts('application/json'), 406)

  const mandate = await deps.mandateService.get(mandateId)
  if (
    !mandate ||
    mandate.revoked ||
    (mandate.expiresAt && mandate.expiresAt < new Date())
  ) {
    return ctx.throw(404)
  }

  ctx.body = mandateToBody(deps, mandate)
}

// Spec: https://docs.openpayments.dev/mandates#create
async function createMandate(
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
  const amount = tryParseAmount(body['amount'])
  if (!amount) return ctx.throw(400, 'invalid amount')
  if (!body.assetCode || typeof body.assetCode !== 'string')
    return ctx.throw(400, 'invalid assetCode')
  if (body.assetScale === undefined || typeof body.assetScale !== 'number')
    return ctx.throw(400, 'invalid assetScale')
  const startAt = Date.parse(body['startAt'] as string)
  if (body.startAt && !startAt) return ctx.throw(400, 'invalid startAt')
  const expiresAt = Date.parse(body['expiresAt'] as string)
  if (body.expiresAt && !expiresAt) return ctx.throw(400, 'invalid expiresAt')
  if (body.interval !== undefined && typeof body.interval !== 'string') {
    return ctx.throw(400, 'invalid interval')
  }

  const mandateOrErr = await deps.mandateService.create({
    accountId,
    amount,
    assetCode: body.assetCode,
    assetScale: body.assetScale,
    startAt: startAt ? new Date(startAt) : undefined,
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    interval: body.interval
  })

  if (isCreateError(mandateOrErr)) {
    return ctx.throw(400, errorToMessage[mandateOrErr])
  }

  ctx.status = 201
  const res = mandateToBody(deps, mandateOrErr)
  ctx.body = res
  ctx.set('Location', res.id)
}

function mandateToBody(deps: ServiceDependencies, mandate: Mandate) {
  const location = `${deps.config.publicHost}/mandates/${mandate.id}`
  return {
    id: location,
    account: `${deps.config.publicHost}/pay/${mandate.accountId}`,
    amount: mandate.amount.toString(),
    assetCode: mandate.assetCode,
    assetScale: mandate.assetScale,
    startAt: mandate.startAt?.toISOString(),
    expiresAt: mandate.expiresAt?.toISOString(),
    interval: mandate.interval,
    balance: mandate.balance.toString()
  }
}

const errorToMessage: {
  [key in CreateError]: string
} = {
  [CreateError.InvalidExpiresAt]: 'invalid expiresAt',
  [CreateError.InvalidInterval]: 'invalid interval',
  [CreateError.UnknownAccount]: 'invalid account'
}

function tryParseAmount(amount: unknown): bigint | null {
  try {
    return BigInt(amount)
  } catch (_) {
    return null
  }
}
