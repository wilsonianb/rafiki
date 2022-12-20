import { RequestLike, validateSignature } from 'http-signature-utils'
import Koa from 'koa'
import {
  AccessType,
  AccessAction,
  GrantAccess,
  GrantAccessJSON,
  GrantOptions
} from './grant'
import { TokenInfo } from './service'
import { HttpSigContext, PaymentPointerContext } from '../../app'

function contextToRequestLike(ctx: HttpSigContext): RequestLike {
  return {
    url: ctx.href,
    method: ctx.method,
    headers: ctx.headers,
    body: ctx.request.body ? JSON.stringify(ctx.request.body) : undefined
  }
}
export function createTokenIntrospectionMiddleware({
  type,
  action
}: {
  type: AccessType
  action: AccessAction
}) {
  return async (
    ctx: PaymentPointerContext,
    next: () => Promise<unknown>
  ): Promise<void> => {
    const config = await ctx.container.use('config')
    try {
      const parts = ctx.request.headers.authorization?.split(' ')
      if (parts?.length !== 2 || parts[0] !== 'GNAP') {
        ctx.throw(401, 'Unauthorized')
      }
      const token = parts[1]
      if (
        process.env.NODE_ENV !== 'production' &&
        token === config.devAccessToken
      ) {
        await next()
        return
      }
      const tokenIntrospectionClient = await ctx.container.use(
        'tokenIntrospectionClient'
      )
      const tokenInfo = await tokenIntrospectionClient.introspect(token)
      if (!tokenInfo) {
        ctx.throw(401, 'Invalid Token')
      }
      const options: GrantOptions = {
        active: tokenInfo.active,
        clientId: tokenInfo.client_id,
        grant: tokenInfo.grant
      }
      if (tokenInfo.access) {
        options.access = tokenInfo.access.map(
          (access: GrantAccessJSON): GrantAccess => {
            const options: GrantAccess = {
              type: access.type,
              actions: access.actions,
              identifier: access.identifier,
              interval: access.interval
            }
            if (access.limits) {
              options.limits = {
                receiver: access.limits.receiver
              }
              if (access.limits.sendAmount) {
                options.limits.sendAmount = {
                  value: BigInt(access.limits.sendAmount.value),
                  assetCode: access.limits.sendAmount.assetCode,
                  assetScale: access.limits.sendAmount.assetScale
                }
              }
              if (access.limits.receiveAmount) {
                options.limits.receiveAmount = {
                  value: BigInt(access.limits.receiveAmount.value),
                  assetCode: access.limits.receiveAmount.assetCode,
                  assetScale: access.limits.receiveAmount.assetScale
                }
              }
            }
            return options
          }
        )
      }
      const grant = new TokenInfo(options, tokenInfo.key)

      const access = grant.findAccess({
        type,
        action,
        identifier: ctx.paymentPointer.url
      })
      if (!access) {
        ctx.throw(403, 'Insufficient Grant')
      }
      ctx.grant = grant

      // Unless the relevant grant action is ReadAll/ListAll add the
      // clientId to ctx for Read/List filtering
      if (access.actions.includes(action)) {
        ctx.clientId = grant.clientId
      }

      await next()
    } catch (err) {
      if (err.status === 401) {
        ctx.status = 401
        ctx.message = err.message
        ctx.set('WWW-Authenticate', `GNAP as_uri=${config.authServerGrantUrl}`)
      } else {
        throw err
      }
    }
  }
}

export const httpsigMiddleware = async (
  ctx: HttpSigContext,
  next: () => Promise<unknown>
): Promise<void> => {
  // TODO: look up client jwks.json
  // https://github.com/interledger/rafiki/issues/737
  if (!ctx.grant?.key.jwk) {
    const logger = await ctx.container.use('logger')
    logger.warn(
      {
        grant: ctx.grant
      },
      'missing grant key'
    )
    ctx.throw(500)
  }
  try {
    if (
      !(await validateSignature(ctx.grant.key.jwk, contextToRequestLike(ctx)))
    ) {
      ctx.throw(401, 'Invalid signature')
    }
  } catch (err) {
    if (err instanceof Koa.HttpError) {
      throw err
    }
    const logger = await ctx.container.use('logger')
    logger.warn(
      {
        err
      },
      'httpsig error'
    )
    ctx.throw(401, `Invalid signature`)
  }
  await next()
}
