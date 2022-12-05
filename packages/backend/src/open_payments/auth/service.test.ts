import { faker } from '@faker-js/faker'
import nock, { Definition } from 'nock'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'

import { AccessType, AccessAction } from './grant'
import { AuthService } from './service'
import { Config } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { HttpMethod, RequestValidator } from 'openapi'
import { createTestApp, TestContainer } from '../../tests/app'
import { TokenInfo } from 'auth'

type IntrospectionBody = {
  access_token: string
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
    tokenInfo: TokenInfo | string | undefined
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
      const tokenInfo = {
        active: true,
        grant: uuid(),
        client: faker.internet.url(),
        access: [
          {
            type: AccessType.IncomingPayment,
            actions: [AccessAction.Read]
          }
        ]
      }
      const scope = mockAuthServer(tokenInfo)
      await expect(authService.introspect(token)).resolves.toEqual(tokenInfo)
      scope.done()
    })
  })
})
