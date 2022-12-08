import axios from 'axios'
import { TokenInfo, ActiveTokenInfo } from 'auth'
import { Logger } from 'pino'
import { OpenAPI, HttpMethod, ResponseValidator } from 'openapi'

export interface AuthService {
  introspect(token: string): Promise<ActiveTokenInfo | undefined>
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
): Promise<ActiveTokenInfo | undefined> {
  try {
    // https://datatracker.ietf.org/doc/html/draft-ietf-gnap-resource-servers#section-3.3
    const requestHeaders = {
      'Content-Type': 'application/json'
    }

    const { status, data } = await axios.post(
      deps.authServerIntrospectionUrl,
      {
        access_token: token
      },
      {
        headers: requestHeaders,
        validateStatus: (status) => status === 200
      }
    )

    deps.validateResponse({
      status,
      body: data
    })

    return data.active ? data : undefined
  } catch (err) {
    if (err.errors) {
      deps.logger.warn({ err }, 'invalid token introspection')
    }
    return
  }
}
