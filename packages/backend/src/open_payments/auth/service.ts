import assert from 'assert'
import axios from 'axios'
import { TokenInfo } from 'auth'
import { Logger } from 'pino'

import { Grant } from './grant'
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
): Promise<Grant | undefined> {
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
    return Grant.fromTokenInfo(data)
  } catch (err) {
    if (err.errors) {
      deps.logger.warn({ err }, 'invalid token introspection')
    }
    return
  }
}
