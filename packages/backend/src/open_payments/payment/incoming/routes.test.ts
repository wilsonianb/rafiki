import * as httpMocks from 'node-mocks-http'
import base64url from 'base64url'
import Knex from 'knex'
import { WorkerUtils, makeWorkerUtils } from 'graphile-worker'
import { v4 as uuid } from 'uuid'
import OpenAPIBackend, { Request } from 'openapi-backend'

import { createContext } from '../../../tests/context'
import { AccountService } from '../../account/service'
import { Account } from '../../account/model'
import { createTestApp, TestContainer } from '../../../tests/app'
import { resetGraphileDb } from '../../../tests/graphileDb'
import { GraphileProducer } from '../../../messaging/graphileProducer'
import { Config, IAppConfig } from '../../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../..'
import { AppServices } from '../../../app'
import { truncateTables } from '../../../tests/tableManager'
import { randomAsset } from '../../../tests/asset'
import { IncomingPaymentService } from './service'
import { IncomingPayment, IncomingPaymentState } from './model'
import { IncomingPaymentRoutes, MAX_EXPIRY } from './routes'
import { AppContext } from '../../../app'
import { isIncomingPaymentError } from './errors'

describe('Incoming Payment Routes', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let knex: Knex
  let workerUtils: WorkerUtils
  let accountService: AccountService
  let incomingPaymentService: IncomingPaymentService
  let config: IAppConfig
  let incomingPaymentRoutes: IncomingPaymentRoutes
  const messageProducer = new GraphileProducer()
  const mockMessageProducer = {
    send: jest.fn()
  }

  const setup = (
    reqOpts: httpMocks.RequestOptions,
    params: Record<string, unknown>
  ): AppContext => {
    const ctx = createContext(
      {
        headers: Object.assign(
          { Accept: 'application/json', 'Content-Type': 'application/json' },
          reqOpts.headers
        )
      },
      params
    )
    ctx.request.body = Object.assign(
      {
        incomingAmount:
          incomingPayment.incomingAmount === undefined
            ? undefined
            : {
                value: incomingPayment.incomingAmount.value.toString(),
                assetScale: incomingPayment.incomingAmount.assetScale,
                assetCode: incomingPayment.incomingAmount.assetCode
              },
        description: incomingPayment.description,
        externalRef: incomingPayment.externalRef,
        expiresAt: incomingPayment.expiresAt.toISOString()
      },
      reqOpts.body
    )
    return ctx
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

      const api = new OpenAPIBackend({ definition: './open-api-spec.yaml' })
      incomingPaymentRoutes = await deps.use('incomingPaymentRoutes')
      jest
        .spyOn(incomingPaymentRoutes, 'create')
        .mockImplementation((ctx) =>
          api.handleRequest(
            ctx.request as Request,
            ctx,
            incomingPaymentRoutes.create
          )
        )
    }
  )

  let asset: { code: string; scale: number }
  let account: Account
  let accountId: string
  let incomingPayment: IncomingPayment
  let expiresAt: Date

  beforeEach(
    async (): Promise<void> => {
      accountService = await deps.use('accountService')
      incomingPaymentService = await deps.use('incomingPaymentService')
      config = await deps.use('config')

      asset = randomAsset()
      expiresAt = new Date(Date.now() + 30_000)
      account = await accountService.create({ asset })
      accountId = `https://wallet.example/${account.id}`
      const incomingPaymentOrError = await incomingPaymentService.create({
        accountId: account.id,
        description: 'text',
        expiresAt,
        incomingAmount: {
          value: BigInt(123),
          assetCode: asset.code,
          assetScale: asset.scale
        },
        externalRef: '#123'
      })
      if (!isIncomingPaymentError(incomingPaymentOrError)) {
        incomingPayment = incomingPaymentOrError
      }
    }
  )

  afterEach(
    async (): Promise<void> => {
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
    test.each`
      id              | headers                     | status | message               | description
      ${'not_a_uuid'} | ${null}                     | ${400} | ${'invalid id'}       | ${'invalid incoming payment id'}
      ${null}         | ${{ Accept: 'text/plain' }} | ${406} | ${'must accept json'} | ${'invalid Accept header'}
      ${uuid()}       | ${null}                     | ${404} | ${'Not Found'}        | ${'unknown incoming payment'}
    `(
      'returns $status on $description',
      async ({ id, headers, status, message }): Promise<void> => {
        const params = id
          ? { incomingPaymentId: id }
          : { incomingPaymentId: incomingPayment.id }
        const ctx = setup({ headers }, params)
        await expect(incomingPaymentRoutes.get(ctx)).rejects.toMatchObject({
          status,
          message
        })
      }
    )

    test('returns 200 with an open payments incoming payment', async (): Promise<void> => {
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        { incomingPaymentId: incomingPayment.id }
      )
      await expect(incomingPaymentRoutes.get(ctx)).resolves.toBeUndefined()
      expect(ctx.status).toBe(200)
      expect(ctx.response.get('Content-Type')).toBe(
        'application/json; charset=utf-8'
      )

      const sharedSecret = (ctx.response.body as Record<string, unknown>)[
        'sharedSecret'
      ]

      expect(ctx.body).toEqual({
        id: `${accountId}/incoming-payments/${incomingPayment.id}`,
        accountId,
        incomingAmount: {
          value: '123',
          assetCode: asset.code,
          assetScale: asset.scale
        },
        description: incomingPayment.description,
        expiresAt: expiresAt.toISOString(),
        receivedAmount: {
          value: '0',
          assetCode: asset.code,
          assetScale: asset.scale
        },
        externalRef: '#123',
        state: IncomingPaymentState.Pending.toLowerCase(),
        ilpAddress: expect.stringMatching(/^test\.rafiki\.[a-zA-Z0-9_-]{95}$/),
        sharedSecret
      })
      const sharedSecretBuffer = Buffer.from(sharedSecret as string, 'base64')
      expect(sharedSecretBuffer).toHaveLength(32)
      expect(sharedSecret).toEqual(base64url(sharedSecretBuffer))
    })
  })
  describe('create', (): void => {
    test.each`
      id              | headers                             | body                                                                    | status | message                     | description
      ${'not_a_uuid'} | ${null}                             | ${null}                                                                 | ${400} | ${'invalid account id'}     | ${'invalid account id'}
      ${null}         | ${{ Accept: 'text/plain' }}         | ${null}                                                                 | ${406} | ${'must accept json'}       | ${'invalid Accept header'}
      ${null}         | ${{ 'Content-Type': 'text/plain' }} | ${null}                                                                 | ${400} | ${'must send json body'}    | ${'invalid Content-Type header'}
      ${uuid()}       | ${null}                             | ${null}                                                                 | ${404} | ${'unknown account'}        | ${'unknown account'}
      ${null}         | ${null}                             | ${{ incomingAmount: 'fail' }}                                           | ${400} | ${'invalid incomingAmount'} | ${'non-object incomingAmount'}
      ${null}         | ${null}                             | ${{ incomingAmount: { value: '-2', assetCode: 'USD', assetScale: 2 } }} | ${400} | ${'invalid amount'}         | ${'invalid incomingAmount, value non-positive'}
      ${null}         | ${null}                             | ${{ incomingAmount: { value: '2', assetCode: 4, assetScale: 2 } }}      | ${400} | ${'invalid incomingAmount'} | ${'invalid incomingAmount, assetCode not string'}
      ${null}         | ${null}                             | ${{ incomingAmount: { value: '2', assetCode: 'USD', assetScale: -2 } }} | ${400} | ${'invalid incomingAmount'} | ${'invalid incomingAmount, assetScale negative'}
      ${null}         | ${null}                             | ${{ description: 123 }}                                                 | ${400} | ${'invalid description'}    | ${'invalid description'}
      ${null}         | ${null}                             | ${{ externalRef: 123 }}                                                 | ${400} | ${'invalid externalRef'}    | ${'invalid externalRef'}
      ${null}         | ${null}                             | ${{ expiresAt: 'fail' }}                                                | ${400} | ${'invalid expiresAt'}      | ${'invalid expiresAt'}
      ${null}         | ${null}                             | ${{ expiresAt: new Date(Date.now() - 1).toISOString() }}                | ${400} | ${'already expired'}        | ${'already expired expiresAt'}
    `(
      'returns $status on $description',
      async ({ id, headers, body, status, message }): Promise<void> => {
        const params = id ? { accountId: id } : { accountId: account.id }
        const ctx = setup({ headers, body }, params)
        await expect(incomingPaymentRoutes.create(ctx)).rejects.toMatchObject({
          status,
          message
        })
      }
    )

    test('returns error on distant-future expiresAt', async (): Promise<void> => {
      const ctx = setup({}, { accountId: account.id })
      ctx.request.body['expiresAt'] = new Date(
        Date.now() + MAX_EXPIRY + 1000
      ).toISOString()
      await expect(incomingPaymentRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'expiry too high'
      )
    })

    test.only('returns the incoming payment on success', async (): Promise<void> => {
      const ctx = setup({}, { accountId: account.id })
      await expect(incomingPaymentRoutes.create(ctx)).resolves.toBeUndefined()
      expect(ctx.response.status).toBe(201)
      const sharedSecret = (ctx.response.body as Record<string, unknown>)[
        'sharedSecret'
      ]
      const incomingPaymentId = ((ctx.response.body as Record<string, unknown>)[
        'id'
      ] as string)
        .split('/')
        .pop()
      expect(ctx.response.body).toEqual({
        id: `${accountId}/incoming-payments/${incomingPaymentId}`,
        accountId,
        incomingAmount: {
          value: incomingPayment.incomingAmount?.value.toString(),
          assetCode: incomingPayment.incomingAmount?.assetCode,
          assetScale: incomingPayment.incomingAmount?.assetScale
        },
        description: incomingPayment.description,
        expiresAt: expiresAt.toISOString(),
        receivedAmount: {
          value: '0',
          assetCode: incomingPayment.asset.code,
          assetScale: incomingPayment.asset.scale
        },
        externalRef: '#123',
        state: IncomingPaymentState.Pending.toLowerCase(),
        ilpAddress: expect.stringMatching(/^test\.rafiki\.[a-zA-Z0-9_-]{95}$/),
        sharedSecret
      })
    })

    test('returns the incoming payment on undefined incomingAmount', async (): Promise<void> => {
      const ctx = setup({}, { accountId: account.id })
      ctx.request.body['incomingAmount'] = undefined
      await expect(incomingPaymentRoutes.create(ctx)).resolves.toBeUndefined()
      expect(ctx.response.status).toBe(201)
      const sharedSecret = (ctx.response.body as Record<string, unknown>)[
        'sharedSecret'
      ]
      const incomingPaymentId = ((ctx.response.body as Record<string, unknown>)[
        'id'
      ] as string)
        .split('/')
        .pop()
      expect(ctx.response.body).toEqual({
        id: `${accountId}/incoming-payments/${incomingPaymentId}`,
        accountId,
        description: incomingPayment.description,
        expiresAt: expiresAt.toISOString(),
        receivedAmount: {
          value: '0',
          assetCode: incomingPayment.asset.code,
          assetScale: incomingPayment.asset.scale
        },
        externalRef: '#123',
        state: IncomingPaymentState.Pending.toLowerCase(),
        ilpAddress: expect.stringMatching(/^test\.rafiki\.[a-zA-Z0-9_-]{95}$/),
        sharedSecret
      })
    })
    test('returns the incoming payment on undefined description', async (): Promise<void> => {
      const ctx = setup({}, { accountId: account.id })
      ctx.request.body['description'] = undefined
      await expect(incomingPaymentRoutes.create(ctx)).resolves.toBeUndefined()
      expect(ctx.response.status).toBe(201)
      const sharedSecret = (ctx.response.body as Record<string, unknown>)[
        'sharedSecret'
      ]
      const incomingPaymentId = ((ctx.response.body as Record<string, unknown>)[
        'id'
      ] as string)
        .split('/')
        .pop()
      expect(ctx.response.body).toEqual({
        id: `${accountId}/incoming-payments/${incomingPaymentId}`,
        accountId,
        incomingAmount: {
          value: incomingPayment.incomingAmount?.value.toString(),
          assetCode: incomingPayment.incomingAmount?.assetCode,
          assetScale: incomingPayment.incomingAmount?.assetScale
        },
        expiresAt: expiresAt.toISOString(),
        receivedAmount: {
          value: '0',
          assetCode: incomingPayment.asset.code,
          assetScale: incomingPayment.asset.scale
        },
        externalRef: '#123',
        state: IncomingPaymentState.Pending.toLowerCase(),
        ilpAddress: expect.stringMatching(/^test\.rafiki\.[a-zA-Z0-9_-]{95}$/),
        sharedSecret
      })
    })

    test('returns the incoming payment on undefined externalRef', async (): Promise<void> => {
      const ctx = setup({}, { accountId: account.id })
      ctx.request.body['externalRef'] = undefined
      await expect(incomingPaymentRoutes.create(ctx)).resolves.toBeUndefined()
      expect(ctx.response.status).toBe(201)
      const sharedSecret = (ctx.response.body as Record<string, unknown>)[
        'sharedSecret'
      ]
      const incomingPaymentId = ((ctx.response.body as Record<string, unknown>)[
        'id'
      ] as string)
        .split('/')
        .pop()
      expect(ctx.response.body).toEqual({
        id: `${accountId}/incoming-payments/${incomingPaymentId}`,
        accountId,
        incomingAmount: {
          value: incomingPayment.incomingAmount?.value.toString(),
          assetCode: incomingPayment.incomingAmount?.assetCode,
          assetScale: incomingPayment.incomingAmount?.assetScale
        },
        description: incomingPayment.description,
        expiresAt: expiresAt.toISOString(),
        receivedAmount: {
          value: '0',
          assetCode: incomingPayment.asset.code,
          assetScale: incomingPayment.asset.scale
        },
        state: IncomingPaymentState.Pending.toLowerCase(),
        ilpAddress: expect.stringMatching(/^test\.rafiki\.[a-zA-Z0-9_-]{95}$/),
        sharedSecret
      })
    })
  })

  describe('update', (): void => {
    test.each`
      id              | headers                             | body                      | status | message                  | description
      ${'not_a_uuid'} | ${null}                             | ${{ state: 'completed' }} | ${400} | ${'invalid id'}          | ${'invalid incoming payment id'}
      ${null}         | ${{ Accept: 'text/plain' }}         | ${{ state: 'completed' }} | ${406} | ${'must accept json'}    | ${'invalid Accept header'}
      ${null}         | ${{ 'Content-Type': 'text/plain' }} | ${{ state: 'completed' }} | ${400} | ${'must send json body'} | ${'invalid Content-Type header'}
      ${null}         | ${null}                             | ${{ state: 123 }}         | ${400} | ${'invalid state'}       | ${'invalid state type'}
      ${null}         | ${null}                             | ${{ state: 'foo' }}       | ${400} | ${'invalid state'}       | ${'invalid state value'}
      ${null}         | ${null}                             | ${{ state: 'expired' }}   | ${400} | ${'invalid state'}       | ${'invalid state'}
      ${uuid()}       | ${null}                             | ${{ state: 'completed' }} | ${404} | ${'unknown payment'}     | ${'unknown incoming payment'}
    `(
      'returns $status on $description',
      async ({ id, headers, body, status, message }): Promise<void> => {
        const params = id
          ? { incomingPaymentId: id }
          : { incomingPaymentId: incomingPayment.id }
        const ctx = setup({ headers, body }, params)
        await expect(incomingPaymentRoutes.update(ctx)).rejects.toMatchObject({
          status,
          message
        })
      }
    )

    test('returns 200 with an updated open payments incoming payment', async (): Promise<void> => {
      const ctx = setup(
        {
          headers: { Accept: 'application/json' },
          body: { state: 'completed' }
        },
        { incomingPaymentId: incomingPayment.id }
      )
      await expect(incomingPaymentRoutes.update(ctx)).resolves.toBeUndefined()
      expect(ctx.status).toBe(200)
      expect(ctx.response.get('Content-Type')).toBe(
        'application/json; charset=utf-8'
      )
      expect(ctx.body).toEqual({
        id: `${accountId}/incoming-payments/${incomingPayment.id}`,
        accountId,
        incomingAmount: {
          value: '123',
          assetCode: asset.code,
          assetScale: asset.scale
        },
        description: incomingPayment.description,
        expiresAt: expiresAt.toISOString(),
        receivedAmount: {
          value: '0',
          assetCode: asset.code,
          assetScale: asset.scale
        },
        externalRef: '#123',
        state: IncomingPaymentState.Completed.toLowerCase()
      })
    })
  })
})
