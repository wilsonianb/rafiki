import { v4 as uuid } from 'uuid'

import { createValidationMiddleware } from './middleware'
import { Config } from '../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../'
import { AppContext, AppServices } from '../app'
import { createTestApp, TestContainer } from '../tests/app'
import { createContext } from '../tests/context'

type AppMiddleware = (
  ctx: AppContext,
  next: () => Promise<void>
) => Promise<void>

describe('Validation Middleware', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let accountId: string
  let middleware: AppMiddleware
  let ctx: AppContext
  let next: jest.MockedFunction<() => Promise<void>>

  beforeAll(
    async (): Promise<void> => {
      deps = await initIocContainer(Config)
      appContainer = await createTestApp(deps)
      accountId = `${Config.publicHost}/${uuid()}`
      middleware = createValidationMiddleware()
    }
  )

  beforeEach((): void => {
    ctx = createContext(
      {
        headers: {
          Accept: 'application/json'
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

  test.each`
    authorization             | description
    ${undefined}              | ${'missing'}
    ${'Bearer NOT-GNAP'}      | ${'invalid'}
    ${'GNAP'}                 | ${'missing'}
    ${'GNAP multiple tokens'} | ${'invalid'}
  `(
    'returns 401 for $description access token',
    async ({ authorization }): Promise<void> => {
      ctx.request.headers.authorization = authorization
      await expect(middleware(ctx, next)).resolves.toBeUndefined()
      expect(ctx.status).toBe(401)
      expect(ctx.message).toEqual('Unauthorized')
      expect(ctx.response.get('WWW-Authenticate')).toBe(
        `GNAP as_uri=${Config.authServerGrantUrl}`
      )
      expect(next).not.toHaveBeenCalled()
    }
  )
})
