import assert from 'assert'
import * as httpMocks from 'node-mocks-http'
import base64url from 'base64url'
import Knex from 'knex'
import { WorkerUtils, makeWorkerUtils } from 'graphile-worker'
import { v4 as uuid } from 'uuid'

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
import { IncomingPaymentService } from './service'
import {
  IncomingPayment,
  IncomingPaymentState,
  IncomingPaymentJSON
} from './model'
import { IncomingPaymentRoutes, MAX_EXPIRY } from './routes'
import { AppContext } from '../../../app'
import { isIncomingPaymentError } from './errors'
import { AccountingService } from '../../../accounting/service'
import { createResponseValidators, ResponseValidators } from '../../validator'

type Validators = ResponseValidators<IncomingPaymentJSON> & {
  update: ResponseValidators<IncomingPaymentJSON>['update']
}

describe('Incoming Payment Routes', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let knex: Knex
  let workerUtils: WorkerUtils
  let accountService: AccountService
  let accountingService: AccountingService
  let incomingPaymentService: IncomingPaymentService
  let config: IAppConfig
  let incomingPaymentRoutes: IncomingPaymentRoutes
  let validators: Validators
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
    if (reqOpts.body !== undefined) {
      ctx.request.body = reqOpts.body
    }

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
      accountingService = await deps.use('accountingService')
      const openApi = await deps.use('openApi')
      validators = createResponseValidators<IncomingPaymentJSON>(
        openApi,
        '/incoming-payments'
      ) as Validators
      assert.ok(validators['update'])
    }
  )

  const asset = {
    code: 'USD',
    scale: 2
  }
  let account: Account
  let accountId: string
  let incomingPayment: IncomingPayment
  let expiresAt: Date

  beforeEach(
    async (): Promise<void> => {
      accountService = await deps.use('accountService')
      incomingPaymentService = await deps.use('incomingPaymentService')
      config = await deps.use('config')
      incomingPaymentRoutes = await deps.use('incomingPaymentRoutes')

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
      id              | headers                     | status | message                          | description
      ${'not_a_uuid'} | ${null}                     | ${400} | ${'id must match format "uuid"'} | ${'invalid incoming payment id'}
      ${null}         | ${{ Accept: 'text/plain' }} | ${406} | ${'must accept json'}            | ${'invalid Accept header'}
      ${uuid()}       | ${null}                     | ${404} | ${'Not Found'}                   | ${'unknown incoming payment'}
    `(
      'returns $status on $description',
      async ({ id, headers, status, message }): Promise<void> => {
        const params = id ? { id } : { id: incomingPayment.id }
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
        { id: incomingPayment.id }
      )
      await expect(incomingPaymentRoutes.get(ctx)).resolves.toBeUndefined()
      assert.ok(validators.read(ctx))

      const sharedSecret = ctx.response.body.sharedSecret

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
        sharedSecret,
        createdAt: incomingPayment.createdAt.toISOString(),
        updatedAt: incomingPayment.updatedAt.toISOString()
      })
      const sharedSecretBuffer = Buffer.from(sharedSecret as string, 'base64')
      expect(sharedSecretBuffer).toHaveLength(32)
      expect(sharedSecret).toEqual(base64url(sharedSecretBuffer))
    })

    test('returns 500 if TB account not found', async (): Promise<void> => {
      jest
        .spyOn(accountingService, 'getTotalReceived')
        .mockResolvedValueOnce(undefined)
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        { id: incomingPayment.id }
      )
      await expect(incomingPaymentRoutes.get(ctx)).rejects.toMatchObject({
        status: 500,
        message: `Error trying to get incoming payment`
      })
    })
  })
  describe('create', (): void => {
    test.each`
      id              | headers                             | body                                                                    | status | message                                              | description
      ${'not_a_uuid'} | ${null}                             | ${null}                                                                 | ${400} | ${'accountId must match format "uuid"'}              | ${'invalid account id'}
      ${null}         | ${{ Accept: 'text/plain' }}         | ${null}                                                                 | ${406} | ${'must accept json'}                                | ${'invalid Accept header'}
      ${null}         | ${{ 'Content-Type': 'text/plain' }} | ${null}                                                                 | ${400} | ${'must send json body'}                             | ${'invalid Content-Type header'}
      ${uuid()}       | ${null}                             | ${{}}                                                                   | ${404} | ${'unknown account'}                                 | ${'unknown account'}
      ${null}         | ${null}                             | ${{ incomingAmount: 'fail' }}                                           | ${400} | ${'incomingAmount must be object'}                   | ${'non-object incomingAmount'}
      ${null}         | ${null}                             | ${{ incomingAmount: { value: '-2', assetCode: 'USD', assetScale: 2 } }} | ${400} | ${'incomingAmount.value must match format "uint64"'} | ${'invalid incomingAmount, value non-positive'}
      ${null}         | ${null}                             | ${{ incomingAmount: { value: '2', assetCode: 4, assetScale: 2 } }}      | ${400} | ${'incomingAmount.assetCode must be string'}         | ${'invalid incomingAmount, assetCode not string'}
      ${null}         | ${null}                             | ${{ incomingAmount: { value: '2', assetCode: 'USD', assetScale: -2 } }} | ${400} | ${'incomingAmount.assetScale must be >= 0'}          | ${'invalid incomingAmount, assetScale negative'}
      ${null}         | ${null}                             | ${{ description: 123 }}                                                 | ${400} | ${'description must be string'}                      | ${'invalid description'}
      ${null}         | ${null}                             | ${{ externalRef: 123 }}                                                 | ${400} | ${'externalRef must be string'}                      | ${'invalid externalRef'}
      ${null}         | ${null}                             | ${{ expiresAt: 'fail' }}                                                | ${400} | ${'expiresAt must match format "date-time"'}         | ${'invalid expiresAt'}
      ${null}         | ${null}                             | ${{ expiresAt: new Date(Date.now() - 1).toISOString() }}                | ${400} | ${'invalid expiresAt'}                               | ${'already expired expiresAt'}
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
      const ctx = setup({ body: {} }, { accountId: account.id })
      ctx.request.body['expiresAt'] = new Date(
        Date.now() + MAX_EXPIRY + 1000
      ).toISOString()
      await expect(incomingPaymentRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'expiry too high'
      )
    })

    test.each`
      incomingAmount                                     | description  | externalRef  | expiresAt
      ${{ value: '2', assetCode: 'USD', assetScale: 2 }} | ${'text'}    | ${'#123'}    | ${new Date(Date.now() + 30_000).toISOString()}
      ${undefined}                                       | ${undefined} | ${undefined} | ${undefined}
    `(
      'returns the incoming payment on success',
      async ({
        incomingAmount,
        description,
        externalRef,
        expiresAt
      }): Promise<void> => {
        const ctx = setup(
          {
            body: {
              incomingAmount,
              description,
              externalRef,
              expiresAt
            }
          },
          { accountId: account.id }
        )
        await expect(incomingPaymentRoutes.create(ctx)).resolves.toBeUndefined()
        assert.ok(validators.create(ctx))
        const incomingPaymentId = (ctx.response.body['id'] as string)
          .split('/')
          .pop()
        expect(ctx.response.body).toEqual({
          id: `${accountId}/incoming-payments/${incomingPaymentId}`,
          accountId,
          incomingAmount,
          description,
          expiresAt: expiresAt || ctx.response.body.expiresAt,
          receivedAmount: {
            value: '0',
            assetCode: incomingPayment.asset.code,
            assetScale: incomingPayment.asset.scale
          },
          externalRef,
          state: IncomingPaymentState.Pending.toLowerCase(),
          ilpAddress: expect.stringMatching(
            /^test\.rafiki\.[a-zA-Z0-9_-]{95}$/
          ),
          sharedSecret: ctx.response.body.sharedSecret,
          createdAt: ctx.response.body.createdAt,
          updatedAt: ctx.response.body.updatedAt
        })
      }
    )
  })

  describe('update', (): void => {
    test.each`
      id              | headers                             | body                      | status | message                                               | description
      ${'not_a_uuid'} | ${null}                             | ${{ state: 'completed' }} | ${400} | ${'id must match format "uuid"'}                      | ${'invalid incoming payment id'}
      ${null}         | ${{ Accept: 'text/plain' }}         | ${{ state: 'completed' }} | ${406} | ${'must accept json'}                                 | ${'invalid Accept header'}
      ${null}         | ${{ 'Content-Type': 'text/plain' }} | ${{ state: 'completed' }} | ${400} | ${'must send json body'}                              | ${'invalid Content-Type header'}
      ${null}         | ${null}                             | ${{ state: 123 }}         | ${400} | ${'state must be string'}                             | ${'invalid state type'}
      ${null}         | ${null}                             | ${{ state: 'foo' }}       | ${400} | ${'state must be equal to one of the allowed values'} | ${'invalid state value'}
      ${null}         | ${null}                             | ${{ state: 'expired' }}   | ${400} | ${'state must be equal to one of the allowed values'} | ${'invalid state'}
      ${uuid()}       | ${null}                             | ${{ state: 'completed' }} | ${404} | ${'unknown payment'}                                  | ${'unknown incoming payment'}
    `(
      'returns $status on $description',
      async ({ id, headers, body, status, message }): Promise<void> => {
        const params = id ? { id: id } : { id: incomingPayment.id }
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
        { id: incomingPayment.id }
      )
      await expect(incomingPaymentRoutes.update(ctx)).resolves.toBeUndefined()
      assert.ok(validators.update && validators.update(ctx))
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
        state: IncomingPaymentState.Completed.toLowerCase(),
        createdAt: incomingPayment.createdAt.toISOString(),
        updatedAt: ctx.body.updatedAt
      })
    })
  })
})
