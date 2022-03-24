import nock from 'nock'
import { URL } from 'url'
// import { v4 as uuid } from 'uuid'

import {
  GrantService,
  Grant,
  GrantOptions,
  AccessType,
  AccessAction
} from './service'
import { Config } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { createTestApp, TestContainer } from '../../tests/app'

describe('Grant Service', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let grantService: GrantService
  let tokenIntrospectionUrl: URL

  beforeAll(
    async (): Promise<void> => {
      deps = await initIocContainer(Config)
      appContainer = await createTestApp(deps)
      grantService = await deps.use('grantService')
      tokenIntrospectionUrl = new URL(Config.tokenIntrospectionUrl)
    }
  )

  afterEach(
    async (): Promise<void> => {
      jest.useRealTimers()
    }
  )

  afterAll(
    async (): Promise<void> => {
      await appContainer.shutdown()
    }
  )

  describe('Get Grant', (): void => {
    let grant: Grant
    const token = 'OS9M2PMHKUR64TB8N6BW7OZB8CDFONP219RP1LT0'

    function mockAuthServer(grant: Grant | undefined = undefined): nock.Scope {
      return nock(tokenIntrospectionUrl.origin)
        .post(tokenIntrospectionUrl.pathname, { access_token: token })
        .reply(grant ? 200 : 404, grant?.toJSON())
    }

    test('Returns undefined for unknown token/grant', async (): Promise<void> => {
      const scope = mockAuthServer()
      await expect(grantService.get(token)).resolves.toBeUndefined()
      expect(scope.isDone()).toBe(true)
    })

    test('Returns undefined for invalid grant', async (): Promise<void> => {
      const scope = nock(tokenIntrospectionUrl.origin)
        .post(tokenIntrospectionUrl.pathname, { access_token: token })
        .reply(200, 'bad grant')
      await expect(grantService.get(token)).resolves.toBeUndefined()
      expect(scope.isDone()).toBe(true)
    })

    test('Returns undefined for inactive grant', async (): Promise<void> => {
      grant = new Grant({
        active: false,
        grant: 'PRY5NM33OM4TB8N6BW7'
      })
      const scope = mockAuthServer(grant)
      await expect(grantService.get(token)).resolves.toEqual(grant)
      expect(scope.isDone()).toBe(true)
    })

    test.each`
      active   | description
      ${true}  | ${'Active'}
      ${false} | ${'Inactive'}
    `(
      '$description Grant can be fetched',
      async ({ active }): Promise<void> => {
        const options: GrantOptions = {
          active,
          grant: 'PRY5NM33OM4TB8N6BW7'
        }
        if (active) {
          options.access = [
            {
              type: AccessType.OutgoingPayment,
              actions: [AccessAction.Read],
              locations: ['https://fynbos.me/alice/']
            },
            {
              type: AccessType.OutgoingPayment,
              actions: [AccessAction.Create, AccessAction.Authorize],
              locations: ['https://fynbos.me/alice/'],
              limits: {
                startAt: new Date('2022-01-01T18:25:43.511Z'),
                expiresAt: new Date('2023-01-01T18:25:43.511Z'),
                interval: 'P1M',
                receiveAmount: {
                  amount: BigInt(500),
                  assetCode: 'EUR',
                  assetScale: 2
                },
                sendAmount: {
                  amount: BigInt(811),
                  assetCode: 'USD',
                  assetScale: 2
                },
                receivingAccount: 'https://uphold.com/aplusvideo'
              }
            },
            {
              type: AccessType.OutgoingPayment,
              actions: [AccessAction.Create, AccessAction.Authorize],
              locations: ['https://fynbos.me/alice/'],
              limits: {
                receivingPayment:
                  'https://uphold.com/nicepayment/fi7td6dito8yf6t'
              }
            }
          ]
        }
        grant = new Grant(options)
        const scope = mockAuthServer(grant)
        await expect(grantService.get(token)).resolves.toEqual(grant)
        expect(scope.isDone()).toBe(true)
      }
    )
  })

  // describe('getAccess', (): void => {
  // })

  // describe('includesAccess', (): void => {
  // })
})
