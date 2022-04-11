import assert from 'assert'
import axios from 'axios'

import {
  AccessType,
  AccessAction,
  Grant,
  GrantOptions,
  GrantAccess,
  GrantAccessJSON
} from './grant'
import { AppContext } from '../../app'

export function createAuthMiddleware({
  type,
  action
}: {
  type: AccessType
  action: AccessAction
}) {
  return async (
    ctx: AppContext,
    next: () => Promise<unknown>
  ): Promise<void> => {
    if (
      !ctx.request.headers.authorization ||
      ctx.request.headers.authorization.split(' ')[0] !== 'GNAP'
    ) {
      ctx.throw(401, 'Unauthorized')
    }
    const token = ctx.request.headers.authorization.split(' ')[1]
    const config = await ctx.container.use('config')
    const grant = await getGrant(config.authServerIntrospectionUrl, token)
    if (!grant || !grant.active) {
      // TODO: WWW-Authenticate
      ctx.throw(401, 'Invalid Token')
    }
    if (
      !grant.includesAccess({
        type,
        action,
        identifier: ctx.params.accountId
      })
    ) {
      ctx.throw(403, 'Insufficient Grant')
    }
    ctx.grant = grant
    await next()
  }
}

async function getGrant(
  authServerIntrospectionUrl: string,
  token: string
): Promise<Grant | undefined> {
  try {
    // https://datatracker.ietf.org/doc/html/draft-ietf-gnap-resource-servers#section-3.3
    const requestHeaders = {
      'Content-Type': 'application/json'
      // TODO:
      // 'Signature-Input': 'sig1=...'
      // 'Signature': 'sig1=...'
      // 'Digest': 'sha256=...'
    }

    const { data } = await axios.post(
      authServerIntrospectionUrl,
      {
        access_token: token
        // TODO:
        // proof: 'httpsig',
        // resource_server: '7C7C4AZ9KHRS6X63AJAO'
      },
      {
        headers: requestHeaders,
        validateStatus: (status) => status === 200
      }
    )
    // TODO: validate data is grant
    assert.ok(data.active !== undefined)
    assert.ok(data.grant)
    const options: GrantOptions = {
      active: data.active,
      grant: data.grant
    }
    if (data.access) {
      options.access = data.access.map(
        (access: GrantAccessJSON): GrantAccess => {
          const options: GrantAccess = {
            type: access.type,
            actions: access.actions,
            locations: access.locations,
            identifier: access.identifier
          }
          if (access.limits) {
            options.limits = {
              interval: access.limits.interval,
              receivingAccount: access.limits.receivingAccount,
              receivingPayment: access.limits.receivingPayment
            }
            if (access.limits.startAt) {
              options.limits.startAt = new Date(access.limits.startAt)
            }
            if (access.limits.expiresAt) {
              options.limits.expiresAt = new Date(access.limits.expiresAt)
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
    return new Grant(options)
  } catch (err) {
    return
  }
}
