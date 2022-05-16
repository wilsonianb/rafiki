import { v4 as uuid } from 'uuid'
import { createMockContext } from '@shopify/jest-koa-mocks'

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

  test('returns 200', async (): Promise<void> => {
    // const ctx = createContext(
    //   {
    //     headers: { Accept: 'application/json' },
    //     url: '/{accountId}/incoming-payments'
    //   }, {}
    // )
    const ctx = createMockContext({
      headers: { Accept: 'application/json' },
      url: `/${uuid()}/incoming-payments`,
      requestBody: {}
    })

    const requestKeys = ['body', 'headers', 'method', 'path', 'query']
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toRequestObject = function (req: any) {
      const result = {}
      requestKeys.forEach((key) => {
        if (key in req) result[key] = req[key]
      })
      return result
    }
    const req = toRequestObject(ctx.request)
    console.log(ctx)
    console.log(ctx.request.body)
    console.log(ctx.req)
    console.log(req)
    // console.log(req.hasOwnProperty('query'))
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(ctx.status).toBe(401)
    expect(ctx.message).toEqual('Unauthorized')
    expect(ctx.response.get('WWW-Authenticate')).toBe(
      `GNAP as_uri=${Config.authServerGrantUrl}`
    )
    expect(next).not.toHaveBeenCalled()
  })
})
