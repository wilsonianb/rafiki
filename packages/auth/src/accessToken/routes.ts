import { Logger } from 'pino'
import { Access } from '../access/model'
import { AppContext } from '../app'
import { IAppConfig } from '../config/app'
import { AccessTokenService } from './service'
import { Grant } from '../grant/model'
import { accessToBody } from '../shared/utils'

interface ServiceDependencies {
  config: IAppConfig
  logger: Logger
  accessTokenService: AccessTokenService
}

export interface AccessTokenRoutes {
  introspect(ctx: AppContext): Promise<void>
  revoke(ctx: AppContext): Promise<void>
  rotate(ctx: AppContext): Promise<void>
}

export function createAccessTokenRoutes(
  deps_: ServiceDependencies
): AccessTokenRoutes {
  const logger = deps_.logger.child({
    service: 'AccessTokenRoutes'
  })
  const deps = { ...deps_, logger }
  return {
    introspect: (ctx: AppContext) => introspectToken(deps, ctx),
    revoke: (ctx: AppContext) => revokeToken(deps, ctx),
    rotate: (ctx: AppContext) => rotateToken(deps, ctx)
  }
}

async function introspectToken(
  deps: ServiceDependencies,
  ctx: AppContext
): Promise<void> {
  const { body } = ctx.request
  const grant = await deps.accessTokenService.introspect(body['access_token'])
  ctx.body = grant
    ? grantToTokenInfo(grant)
    : {
        active: false
      }
}

function grantToTokenInfo(grant: Grant) {
  return {
    active: true,
    grant: grant.id,
    access: grant.access?.map((a: Access) => accessToBody(a)),
    client: grant.client
  }
}

async function revokeToken(
  deps: ServiceDependencies,
  ctx: AppContext
): Promise<void> {
  const { id: managementId } = ctx.params
  await deps.accessTokenService.revoke(managementId)
  ctx.status = 204
}

async function rotateToken(
  deps: ServiceDependencies,
  ctx: AppContext
): Promise<void> {
  // TODO: verify Authorization: GNAP ${accessToken} contains correct token value
  const { id: managementId } = ctx.params
  const result = await deps.accessTokenService.rotate(managementId)
  if (result.success == true) {
    ctx.status = 200
    ctx.body = {
      access_token: {
        access: result.access.map((a) => accessToBody(a)),
        value: result.value,
        manage: deps.config.authServerDomain + `/token/${result.managementId}`,
        expires_in: result.expiresIn
      }
    }
  } else {
    ctx.status = 404
    return ctx.throw(ctx.status, result.error.message)
  }
}
