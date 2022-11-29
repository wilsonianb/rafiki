import assert from 'assert'
import axios from 'axios'
import { TokenInfo } from 'auth'
import { Logger } from 'pino'

import { Grant, GrantOptions, GrantAccess, GrantAccessJSON } from './grant'
import { OpenAPI, HttpMethod, ResponseValidator } from 'openapi'

export interface AuthService {
  introspect(token: string): Promise<TokenInfo | undefined>
}

interface ServiceDependencies {
  authServerIntrospectionUrl: string
  authServerSpec: OpenAPI
  logger: Logger
  validateResponse: ResponseValidator<TokenInfo>
}

export async function createAuthService(
  deps_: Omit<ServiceDependencies, 'validateResponse'>
): Promise<AuthService> {
  const log = deps_.logger.child({
    service: 'AuthService'
  })
  const validateResponse =
    deps_.authServerSpec.createResponseValidator<TokenInfo>({
      path: '/introspect',
      method: HttpMethod.POST
    })
  const deps: ServiceDependencies = {
    ...deps_,
    logger: log,
    validateResponse
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
    const { status, data } = await axios.post(
      deps.authServerIntrospectionUrl,
      {
        access_token: token
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        validateStatus: (status) => status === 200
      }
    )

    assert.ok(
      deps.validateResponse({
        status,
        body: data
      })
    )
    const options: GrantOptions = {
      active: data.active,
      client: data.client,
      grant: data.grant
    }
    if (data.access) {
      options.access = data.access.map(
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
    return new Grant(options)
  } catch (err) {
    if (err.errors) {
      deps.logger.warn({ err }, 'invalid token introspection')
    }
    return
  }
}
