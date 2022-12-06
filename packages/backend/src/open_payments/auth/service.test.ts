import nock, { Definition } from 'nock'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'

import { AccessType, AccessAction } from './grant'
import { AuthService, TokenInfo, TokenInfoJSON } from './service'
import { Config } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { HttpMethod, RequestValidator } from 'openapi'
import { generateJwk } from 'open-payments'
import { createTestApp, TestContainer } from '../../tests/app'

type IntrospectionBody = {
  access_token: string
  resource_server: string
}

describe('Auth Service', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let authServerIntrospectionUrl: URL
  let authService: AuthService
  let validateRequest: RequestValidator<IntrospectionBody>
  const token = 'OS9M2PMHKUR64TB8N6BW7OZB8CDFONP219RP1LT0'

  beforeAll(async (): Promise<void> => {
    deps = await initIocContainer(Config)
    appContainer = await createTestApp(deps)
    const config = await deps.use('config')
    authServerIntrospectionUrl = new URL(config.authServerIntrospectionUrl)
    authService = await deps.use('authService')
    const { authServerSpec } = await deps.use('openApi')
    validateRequest = authServerSpec.createRequestValidator({
      path: '/introspect',
      method: HttpMethod.POST
    })
  })

  afterAll(async (): Promise<void> => {
    await appContainer.shutdown()
  })

  function mockAuthServer(
    tokenInfo: TokenInfoJSON | string | undefined
  ): nock.Scope {
    return nock(authServerIntrospectionUrl.origin)
      .post(
        authServerIntrospectionUrl.pathname,
        function (this: Definition, body) {
          validateRequest({
            ...this,
            body
          })
          expect(body.access_token).toEqual(token)
          return true
        }
      )
      .reply(tokenInfo ? 200 : 404, tokenInfo)
  }

  describe('introspect', (): void => {
    test.each`
      tokenInfo            | description
      ${undefined}         | ${'request error'}
      ${'bad info'}        | ${'invalid response'}
      ${{ active: false }} | ${'inactive token'}
    `(
      'returns undefined for $description',
      async ({ tokenInfo }): Promise<void> => {
        const scope = mockAuthServer(tokenInfo)
        await expect(authService.introspect(token)).resolves.toBeUndefined()
        scope.done()
      }
    )

    test('returns token info', async (): Promise<void> => {
      const tokenInfo = new TokenInfo(
        {
          active: true,
          grant: uuid(),
          clientId: uuid(),
          access: [
            {
              type: AccessType.IncomingPayment,
              actions: [AccessAction.Read]
            }
          ]
        },
        {
          jwk: generateJwk({
            keyId: uuid()
          }),
          proof: 'httpsig'
        }
      )
      const scope = mockAuthServer(tokenInfo.toJSON())
      await expect(authService.introspect(token)).resolves.toEqual(tokenInfo)
      scope.done()
    })
  })
})
