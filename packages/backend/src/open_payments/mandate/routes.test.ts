import assert from 'assert'
import * as httpMocks from 'node-mocks-http'
import Knex from 'knex'
import { WorkerUtils, makeWorkerUtils } from 'graphile-worker'
import { v4 as uuid } from 'uuid'

import { createContext } from '../../tests/context'
import { AccountService } from '../account/service'
import { Account } from '../account/model'
import { createTestApp, TestContainer } from '../../tests/app'
import { resetGraphileDb } from '../../tests/graphileDb'
import { GraphileProducer } from '../../messaging/graphileProducer'
import { Config, IAppConfig } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { truncateTables } from '../../tests/tableManager'
import { randomAsset } from '../../tests/asset'
import { CreateOptions, MandateService } from './service'
import { Mandate } from './model'
import { isCreateError } from './errors'
import { MandateRoutes } from './routes'
import { AppContext } from '../../app'

describe('Mandate Routes', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let knex: Knex
  let workerUtils: WorkerUtils
  let accountService: AccountService
  let mandateService: MandateService
  let config: IAppConfig
  let mandateRoutes: MandateRoutes
  const messageProducer = new GraphileProducer()
  const mockMessageProducer = {
    send: jest.fn()
  }

  beforeAll(
    async (): Promise<void> => {
      config = Config
      config.publicHost = 'https://wallet.example'
      deps = await initIocContainer(config)
      deps.bind('messageProducer', async () => mockMessageProducer)
      appContainer = await createTestApp(deps)
      workerUtils = await makeWorkerUtils({
        connectionString: appContainer.connectionUrl
      })
      await workerUtils.migrate()
      messageProducer.setUtils(workerUtils)
      knex = await deps.use('knex')
    }
  )

  const { code: assetCode, scale: assetScale } = randomAsset()
  let account: Account

  beforeEach(
    async (): Promise<void> => {
      accountService = await deps.use('accountService')
      mandateService = await deps.use('mandateService')
      config = await deps.use('config')
      mandateRoutes = await deps.use('mandateRoutes')

      account = await accountService.create({ asset: randomAsset() })
    }
  )

  afterEach(
    async (): Promise<void> => {
      jest.restoreAllMocks()
      await truncateTables(knex)
    }
  )

  afterAll(
    async (): Promise<void> => {
      await resetGraphileDb(knex)
      await appContainer.shutdown()
      await workerUtils.release()
    }
  )

  describe('get', (): void => {
    let mandate: Mandate

    beforeEach(
      async (): Promise<void> => {
        mandate = (await mandateService.create({
          accountId: account.id,
          amount: BigInt(123),
          assetCode,
          assetScale,
          startAt: new Date(Date.now() + 2000),
          expiresAt: new Date(
            new Date().setFullYear(new Date().getFullYear() + 1)
          ),
          interval: 'P1M'
        })) as Mandate
        assert.ok(!isCreateError(mandate))
      }
    )

    test('returns error on invalid id', async (): Promise<void> => {
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        { mandateId: 'not_a_uuid' }
      )
      await expect(mandateRoutes.get(ctx)).rejects.toHaveProperty(
        'message',
        'invalid id'
      )
    })

    test('returns 406 for wrong Accept', async (): Promise<void> => {
      const ctx = createContext(
        {
          headers: { Accept: 'test/plain' }
        },
        { mandateId: uuid() }
      )
      await expect(mandateRoutes.get(ctx)).rejects.toHaveProperty('status', 406)
    })

    test('returns 404 for nonexistent mandate', async (): Promise<void> => {
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        { mandateId: uuid() }
      )
      await expect(mandateRoutes.get(ctx)).rejects.toHaveProperty('status', 404)
    })

    test('returns 404 for expired mandate', async (): Promise<void> => {
      await mandate.$query(knex).patch({ expiresAt: new Date(Date.now() - 1) })
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        { mandateId: mandate.id }
      )
      await expect(mandateRoutes.get(ctx)).rejects.toHaveProperty('status', 404)
    })

    test('returns 404 for revoked mandate', async (): Promise<void> => {
      await mandate.$query(knex).patch({ revoked: true })
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        { mandateId: mandate.id }
      )
      await expect(mandateRoutes.get(ctx)).rejects.toHaveProperty('status', 404)
    })

    test('returns 200 with an open payments mandate', async (): Promise<void> => {
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        { mandateId: mandate.id }
      )
      await expect(mandateRoutes.get(ctx)).resolves.toBeUndefined()
      expect(ctx.status).toBe(200)
      expect(ctx.response.get('Content-Type')).toBe(
        'application/json; charset=utf-8'
      )

      assert.ok(mandate.startAt && mandate.expiresAt)
      expect(ctx.body).toEqual({
        id: `https://wallet.example/mandates/${mandate.id}`,
        account: `https://wallet.example/pay/${account.id}`,
        amount: mandate.amount.toString(),
        assetCode,
        assetScale,
        startAt: mandate.startAt.toISOString(),
        expiresAt: mandate.expiresAt.toISOString(),
        interval: mandate.interval,
        balance: '0'
      })
    })

    test('returns 200 with a mandate with undefined timing options', async (): Promise<void> => {
      const mandate = await mandateService.create({
        accountId: account.id,
        amount: BigInt(123),
        assetCode,
        assetScale
      })
      assert.ok(!isCreateError(mandate))
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        { mandateId: mandate.id }
      )
      await expect(mandateRoutes.get(ctx)).resolves.toBeUndefined()
      expect(ctx.status).toBe(200)
      expect(ctx.response.get('Content-Type')).toBe(
        'application/json; charset=utf-8'
      )

      expect(ctx.body).toEqual({
        id: `https://wallet.example/mandates/${mandate.id}`,
        account: `https://wallet.example/pay/${account.id}`,
        amount: mandate.amount.toString(),
        assetCode,
        assetScale,
        startAt: undefined,
        expiresAt: undefined,
        interval: null,
        balance: mandate.amount.toString()
      })
    })
  })

  describe('create', (): void => {
    let mandate: CreateOptions

    beforeEach(
      async (): Promise<void> => {
        mandate = {
          accountId: account.id,
          amount: BigInt(123),
          assetCode,
          assetScale,
          startAt: new Date(Date.now() + 2000),
          expiresAt: new Date(
            new Date().setFullYear(new Date().getFullYear() + 1)
          ),
          interval: 'P1M'
        }
      }
    )

    function setup(
      reqOpts: Pick<httpMocks.RequestOptions, 'headers'>
    ): AppContext {
      const ctx = createContext(
        {
          headers: Object.assign(
            { Accept: 'application/json', 'Content-Type': 'application/json' },
            reqOpts.headers
          )
        },
        { accountId: account.id }
      )
      ctx.request.body = {
        amount: mandate.amount,
        assetCode,
        assetScale,
        startAt: mandate.startAt?.toISOString(),
        expiresAt: mandate.expiresAt?.toISOString(),
        interval: mandate.interval
      }
      return ctx
    }

    test('returns error on invalid account id', async (): Promise<void> => {
      const ctx = setup({})
      ctx.params.accountId = 'not_a_uuid'
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid account id'
      )
    })

    test('returns error on unknown account', async (): Promise<void> => {
      const ctx = setup({})
      ctx.params.accountId = uuid()
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid account'
      )
    })

    test('returns 406 on invalid Accept', async (): Promise<void> => {
      const ctx = setup({ headers: { Accept: 'text/plain' } })
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'status',
        406
      )
    })

    test('returns error on invalid Content-Type', async (): Promise<void> => {
      const ctx = setup({ headers: { 'Content-Type': 'text/plain' } })
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'must send json body'
      )
    })

    test('returns error on missing amount', async (): Promise<void> => {
      const ctx = setup({})
      ctx.request.body['amount'] = undefined
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid amount'
      )
    })

    test('returns error on invalid amount', async (): Promise<void> => {
      const ctx = setup({})
      ctx.request.body['amount'] = 'fail'
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid amount'
      )
    })

    test('returns error on missing assetCode', async (): Promise<void> => {
      const ctx = setup({})
      ctx.request.body['assetCode'] = undefined
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid assetCode'
      )
    })

    test('returns error on invalid assetCode', async (): Promise<void> => {
      const ctx = setup({})
      ctx.request.body['assetCode'] = 123
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid assetCode'
      )
    })

    test('returns error on missing assetScale', async (): Promise<void> => {
      const ctx = setup({})
      ctx.request.body['assetScale'] = undefined
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid assetScale'
      )
    })

    test('returns error on invalid assetScale', async (): Promise<void> => {
      const ctx = setup({})
      ctx.request.body['assetScale'] = 'NaN'
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid assetScale'
      )
    })

    test('returns error on invalid startAt', async (): Promise<void> => {
      const ctx = setup({})
      ctx.request.body['startAt'] = 'fail'
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid startAt'
      )
    })

    test('returns error on invalid expiresAt', async (): Promise<void> => {
      const ctx = setup({})
      ctx.request.body['expiresAt'] = 'fail'
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid expiresAt'
      )
    })

    test('returns error on already-expired expiresAt', async (): Promise<void> => {
      const ctx = setup({})
      ctx.request.body['expiresAt'] = new Date(Date.now() - 1).toISOString()
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid expiresAt'
      )
    })

    test('returns error on invalid interval', async (): Promise<void> => {
      const ctx = setup({})
      ctx.request.body['interval'] = 123
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid interval'
      )
    })

    test('returns error on invalid interval string', async (): Promise<void> => {
      const ctx = setup({})
      ctx.request.body['interval'] = 'fail'
      await expect(mandateRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid interval'
      )
    })

    test('returns the mandate on success', async (): Promise<void> => {
      const ctx = setup({})
      await expect(mandateRoutes.create(ctx)).resolves.toBeUndefined()
      expect(ctx.response.status).toBe(201)
      const mandateId = ((ctx.response.body as Record<string, unknown>)[
        'id'
      ] as string)
        .split('/')
        .pop()
      expect(ctx.response.headers['location']).toBe(
        `${config.publicHost}/mandates/${mandateId}`
      )
      assert.ok(mandate.startAt && mandate.expiresAt)
      expect(ctx.response.body).toEqual({
        id: `${config.publicHost}/mandates/${mandateId}`,
        account: `${config.publicHost}/pay/${mandate.accountId}`,
        amount: mandate.amount.toString(),
        assetCode,
        assetScale,
        startAt: mandate.startAt.toISOString(),
        expiresAt: mandate.expiresAt.toISOString(),
        interval: mandate.interval,
        balance: '0'
      })
    })

    test('returns the mandate with undefined timing options', async (): Promise<void> => {
      const ctx = setup({})
      ctx.request.body['startAt'] = undefined
      ctx.request.body['expiresAt'] = undefined
      ctx.request.body['interval'] = undefined
      await expect(mandateRoutes.create(ctx)).resolves.toBeUndefined()
      expect(ctx.response.status).toBe(201)
      const mandateId = ((ctx.response.body as Record<string, unknown>)[
        'id'
      ] as string)
        .split('/')
        .pop()
      expect(ctx.response.headers['location']).toBe(
        `${config.publicHost}/mandates/${mandateId}`
      )
      expect(ctx.response.body).toEqual({
        id: `${config.publicHost}/mandates/${mandateId}`,
        account: `${config.publicHost}/pay/${mandate.accountId}`,
        amount: mandate.amount.toString(),
        assetCode,
        assetScale,
        startAt: undefined,
        expiresAt: undefined,
        interval: null,
        balance: mandate.amount.toString()
      })
    })
  })
})
