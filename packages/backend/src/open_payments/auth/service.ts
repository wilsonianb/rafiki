import { Logger } from 'pino'

import {
  Grant,
  GrantJSON,
  GrantOptions,
  GrantAccess,
  GrantAccessJSON
} from './grant'
import { JWK } from 'http-signature-utils'
import { Client } from 'token-introspection'

export interface KeyInfo {
  proof: string
  jwk: JWK
}

export interface TokenInfoJSON extends GrantJSON {
  key: KeyInfo
}

export class TokenInfo extends Grant {
  public readonly key: KeyInfo

  constructor(options: GrantOptions, key: KeyInfo) {
    super(options)
    this.key = key
  }

  public toJSON(): TokenInfoJSON {
    return {
      ...super.toJSON(),
      key: this.key
    }
  }
}

export interface AuthService {
  introspect(token: string): Promise<TokenInfo | undefined>
}

interface ServiceDependencies {
  client: Client
  logger: Logger
}

export async function createAuthService(
  deps_: ServiceDependencies
): Promise<AuthService> {
  const log = deps_.logger.child({
    service: 'AuthService'
  })
  const deps: ServiceDependencies = {
    ...deps_,
    logger: log
  }
  return {
    introspect: (token) => introspectToken(deps, token)
  }
}

async function introspectToken(
  deps: ServiceDependencies,
  token: string
): Promise<TokenInfo | undefined> {
  try {
    const tokenInfo = await deps.client.introspect({
      access_token: token,
      // TODO
      resource_server: '7C7C4AZ9KHRS6X63AJAO'
      // proof: 'httpsig'
    })

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
    return new TokenInfo(options, tokenInfo.key)
  } catch (err) {
    if (err.errors) {
      deps.logger.warn({ err }, 'invalid token introspection')
    }
    return
  }
}
