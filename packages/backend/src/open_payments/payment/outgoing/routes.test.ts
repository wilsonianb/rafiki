import assert from 'assert'
import * as httpMocks from 'node-mocks-http'
import Knex from 'knex'
import { WorkerUtils, makeWorkerUtils } from 'graphile-worker'
import { v4 as uuid } from 'uuid'

import { createContext } from '../../../tests/context'
import { createTestApp, TestContainer } from '../../../tests/app'
import { resetGraphileDb } from '../../../tests/graphileDb'
import { GraphileProducer } from '../../../messaging/graphileProducer'
import { Config, IAppConfig } from '../../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../..'
import { AppServices } from '../../../app'
import { truncateTables } from '../../../tests/tableManager'
import { randomAsset } from '../../../tests/asset'
import { CreateOutgoingPaymentOptions } from './service'
import { isOutgoingPaymentError } from './errors'
import {
  OutgoingPayment,
  OutgoingPaymentState,
  OutgoingPaymentJSON
} from './model'
import { OutgoingPaymentRoutes } from './routes'
import { Amount } from '../../amount'
import { createOutgoingPayment } from '../../../tests/outgoingPayment'
import { createQuote } from '../../../tests/quote'
import { AppContext } from '../../../app'
import { AccountingService } from '../../../accounting/service'
import { OpenAPI, HttpMethod } from '../../../openapi'
import { createResponseValidator } from '../../../openapi/validator'

describe('Outgoing Payment Routes', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let knex: Knex
  let workerUtils: WorkerUtils
  let config: IAppConfig
  let outgoingPaymentRoutes: OutgoingPaymentRoutes
  let accountId: string
  let accountUrl: string
  let accountingService: AccountingService
  let openApi: OpenAPI

  const messageProducer = new GraphileProducer()
  const mockMessageProducer = {
    send: jest.fn()
  }
  const receivingAccount = `https://wallet.example/${uuid()}`
  const asset = randomAsset()
  const sendAmount: Amount = {
    value: BigInt(123),
    assetCode: asset.code,
    assetScale: asset.scale
  }

  const createPayment = async (options: {
    accountId: string
    description?: string
    externalRef?: string
  }): Promise<OutgoingPayment> => {
    return await createOutgoingPayment(deps, {
      ...options,
      receivingAccount,
      sendAmount: {
        value: BigInt(56),
        assetCode: asset.code,
        assetScale: asset.scale
      },
      validDestination: false
    })
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
      config = await deps.use('config')
      outgoingPaymentRoutes = await deps.use('outgoingPaymentRoutes')
      accountingService = await deps.use('accountingService')
      openApi = await deps.use('openApi')
    }
  )

  beforeEach(
    async (): Promise<void> => {
      const accountService = await deps.use('accountService')
      accountId = (await accountService.create({ asset })).id
      accountUrl = `${config.publicHost}/${accountId}`
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
    test('returns error on invalid id', async (): Promise<void> => {
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        {
          id: 'not_a_uuid',
          accountId
        }
      )
      await expect(outgoingPaymentRoutes.get(ctx)).rejects.toHaveProperty(
        'message',
        'id must match format "uuid"'
      )
    })

    test('returns error on invalid accountId', async (): Promise<void> => {
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        {
          id: uuid(),
          accountId: 'not_a_uuid'
        }
      )
      await expect(outgoingPaymentRoutes.get(ctx)).rejects.toHaveProperty(
        'message',
        'accountId must match format "uuid"'
      )
    })

    test('returns 406 for wrong Accept', async (): Promise<void> => {
      const ctx = createContext(
        {
          headers: { Accept: 'test/plain' }
        },
        {
          id: uuid(),
          accountId
        }
      )
      await expect(outgoingPaymentRoutes.get(ctx)).rejects.toHaveProperty(
        'status',
        406
      )
    })

    test('returns 404 for nonexistent outgoing payment', async (): Promise<void> => {
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        {
          id: uuid(),
          accountId
        }
      )
      await expect(outgoingPaymentRoutes.get(ctx)).rejects.toHaveProperty(
        'status',
        404
      )
    })

    test('returns 500 if TB account not found', async (): Promise<void> => {
      const outgoingPayment = await createPayment({
        accountId
      })
      assert.ok(!isOutgoingPaymentError(outgoingPayment))
      jest
        .spyOn(accountingService, 'getTotalSent')
        .mockResolvedValueOnce(undefined)
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        {
          id: outgoingPayment.id,
          accountId
        }
      )
      await expect(outgoingPaymentRoutes.get(ctx)).rejects.toMatchObject({
        status: 500,
        message: `Error trying to get outgoing payment`
      })
    })

    test('returns 200 with an outgoing payment', async (): Promise<void> => {
      const outgoingPayment = await createPayment({
        accountId,
        description: 'rent',
        externalRef: '202201'
      })
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        {
          id: outgoingPayment.id,
          accountId
        }
      )
      await expect(outgoingPaymentRoutes.get(ctx)).resolves.toBeUndefined()
      const validate = createResponseValidator<OutgoingPaymentJSON>({
        path: openApi.paths[outgoingPaymentRoutes.resourcePath],
        method: HttpMethod.GET
      })
      assert.ok(validate(ctx))

      expect(ctx.body).toEqual({
        id: `${accountUrl}/outgoing-payments/${outgoingPayment.id}`,
        accountId: accountUrl,
        receivingPayment: outgoingPayment.receivingPayment,
        sendAmount: {
          ...outgoingPayment.sendAmount,
          value: outgoingPayment.sendAmount.value.toString()
        },
        sentAmount: {
          value: '0',
          assetCode: asset.code,
          assetScale: asset.scale
        },
        receiveAmount: {
          ...outgoingPayment.receiveAmount,
          value: outgoingPayment.receiveAmount.value.toString()
        },
        state: 'processing',
        description: outgoingPayment.description,
        externalRef: outgoingPayment.externalRef,
        createdAt: outgoingPayment.createdAt.toISOString(),
        updatedAt: outgoingPayment.updatedAt.toISOString()
      })
    })

    Object.values(OutgoingPaymentState).forEach((state) => {
      test(`returns 200 with a(n) ${state} outgoing payment`, async (): Promise<void> => {
        const outgoingPayment = await createPayment({
          accountId
        })
        assert.ok(!isOutgoingPaymentError(outgoingPayment))
        await outgoingPayment.$query(knex).patch({ state })
        const ctx = createContext(
          {
            headers: { Accept: 'application/json' }
          },
          { id: outgoingPayment.id }
        )
        await expect(outgoingPaymentRoutes.get(ctx)).resolves.toBeUndefined()
        const validate = createResponseValidator<OutgoingPaymentJSON>({
          path: openApi.paths[outgoingPaymentRoutes.resourcePath],
          method: HttpMethod.GET
        })
        assert.ok(validate(ctx))
        expect(ctx.body).toEqual({
          id: `${accountUrl}/outgoing-payments/${outgoingPayment.id}`,
          accountId: accountUrl,
          receivingPayment: outgoingPayment.receivingPayment,
          sentAmount: {
            value: '0',
            assetCode: asset.code,
            assetScale: asset.scale
          },
          state: [
            OutgoingPaymentState.Funding,
            OutgoingPaymentState.Sending
          ].includes(state)
            ? 'processing'
            : state.toLowerCase(),
          sendAmount: {
            ...outgoingPayment.sendAmount,
            value: outgoingPayment.sendAmount.value.toString()
          },
          receiveAmount: {
            ...outgoingPayment.receiveAmount,
            value: outgoingPayment.receiveAmount.value.toString()
          },
          createdAt: outgoingPayment.createdAt.toISOString(),
          updatedAt: outgoingPayment.updatedAt.toISOString()
        })
      })
    })
  })

  describe('create', (): void => {
    let options: Omit<CreateOutgoingPaymentOptions, 'accountId'>

    beforeEach(() => {
      options = {
        quoteId: `https://wallet.example/${accountId}/quotes/${uuid()}`
      }
    })

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
        { accountId }
      )
      ctx.request.body = options
      return ctx
    }

    test('returns error on invalid id', async (): Promise<void> => {
      const ctx = setup({})
      ctx.params.accountId = 'not_a_uuid'
      await expect(outgoingPaymentRoutes.create(ctx)).rejects.toMatchObject({
        message: 'accountId must match format "uuid"',
        status: 400
      })
    })

    test('returns 406 on invalid Accept', async (): Promise<void> => {
      const ctx = setup({ headers: { Accept: 'text/plain' } })
      await expect(outgoingPaymentRoutes.create(ctx)).rejects.toMatchObject({
        message: 'must accept json',
        status: 406
      })
    })

    test('returns error on invalid Content-Type', async (): Promise<void> => {
      const ctx = setup({ headers: { 'Content-Type': 'text/plain' } })
      await expect(outgoingPaymentRoutes.create(ctx)).rejects.toMatchObject({
        message: 'must send json body',
        status: 400
      })
    })

    test.each`
      field            | invalidValue
      ${'quoteId'}     | ${123}
      ${'description'} | ${123}
      ${'externalRef'} | ${123}
    `(
      'returns error on invalid $field',
      async ({ field, invalidValue }): Promise<void> => {
        const ctx = setup({})
        ctx.request.body[field] = invalidValue
        await expect(outgoingPaymentRoutes.create(ctx)).rejects.toMatchObject({
          message: `${field} must be string`,
          status: 400
        })
      }
    )

    test.each`
      description  | externalRef  | desc
      ${'rent'}    | ${undefined} | ${'description'}
      ${undefined} | ${'202201'}  | ${'externalRef'}
    `(
      'returns the outgoing payment on success ($desc)',
      async ({ description, externalRef }): Promise<void> => {
        const quote = await createQuote(deps, {
          accountId,
          receivingAccount,
          sendAmount,
          validDestination: false
        })
        options = {
          quoteId: `https://wallet.example/${accountId}/quotes/${quote.id}`,
          description,
          externalRef
        }
        const ctx = setup({})
        await expect(outgoingPaymentRoutes.create(ctx)).resolves.toBeUndefined()
        const validate = createResponseValidator<OutgoingPaymentJSON>({
          path: openApi.paths[outgoingPaymentRoutes.collectionPath],
          method: HttpMethod.POST
        })
        assert.ok(validate(ctx))
        const outgoingPaymentId = ctx.response.body.id.split('/').pop()
        expect(ctx.response.body).toEqual({
          id: `${accountUrl}/outgoing-payments/${outgoingPaymentId}`,
          accountId: accountUrl,
          receivingPayment: quote.receivingPayment,
          sendAmount: {
            ...quote.sendAmount,
            value: quote.sendAmount.value.toString()
          },
          receiveAmount: {
            ...quote.receiveAmount,
            value: quote.receiveAmount.value.toString()
          },
          description: options.description,
          externalRef: options.externalRef,
          state: 'processing',
          sentAmount: {
            value: '0',
            assetCode: asset.code,
            assetScale: asset.scale
          },
          createdAt: ctx.body.createdAt,
          updatedAt: ctx.body.updatedAt
        })
      }
    )
  })
})
