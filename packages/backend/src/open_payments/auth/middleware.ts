import { AccessType, AccessAction } from './grant'
import { getSigInputKeyId, HttpSigContext, verifySigAndChallenge } from 'auth'
import { parseLimits } from '../payment/outgoing/limits'

export function createAuthMiddleware({
  type,
  action
}: {
  type: AccessType
  action: AccessAction
}) {
  return async (
    ctx: HttpSigContext,
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
      const authService = await ctx.container.use('authService')
      const tokenInfo = await authService.introspect(token)
      if (!tokenInfo) {
        ctx.throw(401, 'Invalid Token')
      }
      const access = tokenInfo.access.find(
        (access) =>
          access.type == type &&
          (!access['identifier'] ||
            access['identifier'] === ctx.paymentPointer.url) &&
          access.actions.find((tokenAction) => {
            if (tokenAction == action) {
              // Unless the relevant grant action is ReadAll/ListAll add the
              // client to ctx for Read/List filtering
              ctx.client = tokenInfo.client
              return true
            }
            return (
              (action === AccessAction.Read &&
                tokenAction == AccessAction.ReadAll) ||
              (action === AccessAction.List &&
                tokenAction == AccessAction.ListAll)
            )
          })
      )
      if (!access) {
        ctx.throw(403, 'Insufficient Grant')
      }
      if (!config.bypassSignatureValidation) {
        const sigInput = ctx.headers['signature-input']
        const keyId = getSigInputKeyId(sigInput)
        if (!keyId) {
          ctx.throw(401, 'Invalid signature input')
        }
        // TODO: get client key
        const openPaymentsClient = await ctx.container.use('openPaymentsClient')
        const keys = await openPaymentsClient.paymentPointer.getKeys()
        if (!keys) {
          ctx.throw(401, 'Invalid signature input')
        }
        const key = keys.find((key) => key.kid === keyId)
        if (!key) {
          ctx.throw(401, 'Invalid signature input')
        }
        try {
          if (!(await verifySigAndChallenge(key, ctx))) {
            ctx.throw(401, 'Invalid signature')
          }
        } catch (e) {
          ctx.status = 401
          ctx.throw(401, `Invalid signature`)
        }
      }
      if (
        type === AccessType.OutgoingPayment &&
        action === AccessAction.Create
      ) {
        ctx.grant = {
          id: tokenInfo.grant,
          limits: access['limits'] ? parseLimits(access['limits']) : undefined
        }
      }

      // Unless the relevant grant action is ReadAll/ListAll add the
      // client to ctx for Read/List filtering
      if (access.actions.find((accessAction) => accessAction == action)) {
        ctx.client = tokenInfo.client
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
