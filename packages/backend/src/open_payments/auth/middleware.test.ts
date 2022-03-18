import nock from 'nock'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'

import { createAuthMiddleware } from './middleware'
import { Grant, GrantJSON, AccessType, AccessAction } from './grant'
import { Config } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppContext, AppServices } from '../../app'
import { createTestApp, TestContainer } from '../../tests/app'
import { createContext } from '../../tests/context'

type AppMiddleware = (
  ctx: AppContext,
  next: () => Promise<void>
) => Promise<void>

describe('Auth Middleware', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let accountId: string
  let authServerIntrospectionUrl: URL
  let middleware: AppMiddleware
  let ctx: AppContext
  let next: jest.MockedFunction<() => Promise<void>>
  const token = 'OS9M2PMHKUR64TB8N6BW7OZB8CDFONP219RP1LT0'

  beforeAll(
    async (): Promise<void> => {
      deps = await initIocContainer(Config)
      appContainer = await createTestApp(deps)
      accountId = `${Config.publicHost}/${uuid()}`
      authServerIntrospectionUrl = new URL(Config.authServerIntrospectionUrl)
      middleware = createAuthMiddleware({
        type: AccessType.IncomingPayment,
        action: AccessAction.Read
      })
    }
  )

  beforeEach((): void => {
    ctx = createContext(
      {
        headers: {
          Accept: 'application/json',
          Authorization: `GNAP ${token}`
        }
      },
      {
        accountId
      }
    )
    ctx.container = deps
    next = jest.fn()
  })

  afterAll(
    async (): Promise<void> => {
      await appContainer.shutdown()
    }
  )

  function mockAuthServer(
    grant: GrantJSON | string | undefined = undefined
  ): nock.Scope {
    return nock(authServerIntrospectionUrl.origin)
      .post(authServerIntrospectionUrl.pathname, { access_token: token })
      .reply(grant ? 200 : 404, grant)
  }

  test('Returns 401 for missing access token', async (): Promise<void> => {
    ctx.request.headers.authorization = undefined
    await expect(middleware(ctx, next)).rejects.toMatchObject({
      status: 401,
      message: 'Unauthorized'
    })
    expect(next).not.toHaveBeenCalled()
  })

  test('Returns 401 for invalid access token', async (): Promise<void> => {
    ctx.request.headers.authorization = 'Bearer NOT-GNAP'
    await expect(middleware(ctx, next)).rejects.toMatchObject({
      status: 401,
      message: 'Unauthorized'
    })
    expect(next).not.toHaveBeenCalled()
  })

  test('returns 401 for unknown token/grant', async (): Promise<void> => {
    const scope = mockAuthServer()
    await expect(middleware(ctx, next)).rejects.toMatchObject({
      status: 401,
      message: 'Invalid Token'
    })
    expect(next).not.toHaveBeenCalled()
    scope.isDone()
  })

  test('returns 401 for invalid grant', async (): Promise<void> => {
    const scope = mockAuthServer('bad grant')
    await expect(middleware(ctx, next)).rejects.toMatchObject({
      status: 401,
      message: 'Invalid Token'
    })
    expect(next).not.toHaveBeenCalled()
    scope.isDone()
  })

  test('returns 401 for inactive grant', async (): Promise<void> => {
    const scope = mockAuthServer({
      active: false,
      grant: 'PRY5NM33OM4TB8N6BW7'
    })
    await expect(middleware(ctx, next)).rejects.toMatchObject({
      status: 401,
      message: 'Invalid Token'
    })
    expect(next).not.toHaveBeenCalled()
    scope.isDone()
  })

  test('returns 403 for unauthorized request', async (): Promise<void> => {
    const scope = mockAuthServer({
      active: true,
      grant: 'PRY5NM33OM4TB8N6BW7',
      access: [
        {
          type: AccessType.OutgoingPayment,
          actions: [AccessAction.Create]
        }
      ]
    })
    await expect(middleware(ctx, next)).rejects.toMatchObject({
      status: 403,
      message: 'Insufficient Grant'
    })
    expect(next).not.toHaveBeenCalled()
    scope.isDone()
  })

  test.each`
    limitAccount
    ${false}
    ${true}
  `(
    'sets the context grant and calls next (limitAccount: $limitAccount)',
    async ({ limitAccount }): Promise<void> => {
      const grant = new Grant({
        active: true,
        grant: 'PRY5NM33OM4TB8N6BW7',
        access: [
          {
            type: AccessType.IncomingPayment,
            actions: [AccessAction.Read],
            locations: ['https://wallet.example/'],
            identifier: limitAccount ? ctx.params.accountId : undefined
          },
          {
            type: AccessType.OutgoingPayment,
            actions: [AccessAction.Create, AccessAction.Authorize],
            locations: ['https://wallet.example/'],
            identifier: 'alice',
            limits: {
              startAt: new Date('2022-01-01T18:25:43.511Z'),
              expiresAt: new Date('2023-01-01T18:25:43.511Z'),
              interval: 'P1M',
              receiveAmount: {
                value: BigInt(500),
                assetCode: 'EUR',
                assetScale: 2
              },
              sendAmount: {
                value: BigInt(811),
                assetCode: 'USD',
                assetScale: 2
              },
              receivingAccount: 'https://wallet2.example/bob'
            }
          },
          {
            type: AccessType.OutgoingPayment,
            actions: [AccessAction.Update, AccessAction.Authorize],
            locations: ['https://wallet.example/'],
            identifier: 'alice',
            limits: {
              receivingPayment:
                'https://wallet2.example/bob/incoming-payments/fi7td6dito8yf6t'
            }
          }
        ]
      })
      const scope = mockAuthServer(grant.toJSON())
      await expect(middleware(ctx, next)).resolves.toBeUndefined()
      expect(next).toHaveBeenCalled()
      expect(ctx.grant).toEqual(grant)
      scope.isDone()
    }
  )
})
