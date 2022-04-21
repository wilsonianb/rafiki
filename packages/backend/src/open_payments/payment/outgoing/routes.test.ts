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
import { OutgoingPaymentService, CreateOutgoingPaymentOptions } from './service'
import { isOutgoingPaymentError } from './errors'
import { OutgoingPayment, OutgoingPaymentState } from './model'
import { OutgoingPaymentRoutes } from './routes'
import { Amount } from '../../amount'
import { IncomingPayment } from '../incoming/model'
import { isIncomingPaymentError } from '../incoming/errors'
import { Quote } from '../../quote/model'
import { CreateQuoteOptions, QuoteService } from '../../quote/service'
import { createQuote } from '../../../tests/quote'
import { AppContext } from '../../../app'

describe('Outgoing Payment Routes', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let knex: Knex
  let workerUtils: WorkerUtils
  let outgoingPaymentService: OutgoingPaymentService
  let config: IAppConfig
  let outgoingPaymentRoutes: OutgoingPaymentRoutes
  let quoteService: QuoteService
  let accountId: string
  let accountUrl: string
  let receivingAccount: string
  let receivingPayment: string
  let incomingPayment: IncomingPayment

  const messageProducer = new GraphileProducer()
  const mockMessageProducer = {
    send: jest.fn()
  }
  const asset = {
    scale: 9,
    code: 'USD'
  }
  const sendAmount: Amount = {
    value: BigInt(123),
    assetCode: asset.code,
    assetScale: asset.scale
  }

  const destinationAsset = {
    scale: 9,
    code: 'XRP'
  }

  const createAccountQuote = async (accountId: string): Promise<Quote> => {
    const accountService = await deps.use('accountService')
    const { id: receivingAccountId } = await accountService.create({
      asset: destinationAsset
    })
    return await createQuote(deps, {
      accountId,
      receivingAccount: `${Config.publicHost}/${receivingAccountId}`,
      receiveAmount: {
        value: BigInt(56),
        assetCode: destinationAsset.code,
        assetScale: destinationAsset.scale
      }
    })
  }

  const createPayment = async (options: {
    accountId: string
    description?: string
    externalRef?: string
  }): Promise<OutgoingPayment> => {
    const { id: quoteId } = await createAccountQuote(accountId)
    const payment = await outgoingPaymentService.create({
      ...options,
      quoteId
    })
    assert.ok(!isOutgoingPaymentError(payment))
    return payment
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
      outgoingPaymentService = await deps.use('outgoingPaymentService')
      config = await deps.use('config')
      outgoingPaymentRoutes = await deps.use('outgoingPaymentRoutes')
      quoteService = await deps.use('quoteService')
    }
  )

  beforeEach(
    async (): Promise<void> => {
      const accountService = await deps.use('accountService')
      accountId = (
        await accountService.create({
          asset: {
            code: sendAmount.assetCode,
            scale: sendAmount.assetScale
          }
        })
      ).id
      accountUrl = `${config.publicHost}/${accountId}`
      const destinationAccount = await accountService.create({
        asset: destinationAsset
      })
      const accountingService = await deps.use('accountingService')
      await expect(
        accountingService.createDeposit({
          id: uuid(),
          account: destinationAccount.asset,
          amount: BigInt(123)
        })
      ).resolves.toBeUndefined()
      receivingAccount = `${config.publicHost}/${destinationAccount.id}`
      const incomingPaymentService = await deps.use('incomingPaymentService')
      incomingPayment = (await incomingPaymentService.create({
        accountId: destinationAccount.id,
        incomingAmount: {
          value: BigInt(56),
          assetCode: destinationAsset.code,
          assetScale: destinationAsset.scale
        },
        description: 'description!'
      })) as IncomingPayment
      assert.ok(!isIncomingPaymentError(incomingPayment))
      receivingPayment = `${receivingAccount}/incoming-payments/${incomingPayment.id}`
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
        { outgoingPaymentId: 'not_a_uuid' }
      )
      await expect(outgoingPaymentRoutes.get(ctx)).rejects.toHaveProperty(
        'message',
        'invalid id'
      )
    })

    test('returns 406 for wrong Accept', async (): Promise<void> => {
      const ctx = createContext(
        {
          headers: { Accept: 'test/plain' }
        },
        { outgoingPaymentId: uuid() }
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
        { outgoingPaymentId: uuid() }
      )
      await expect(outgoingPaymentRoutes.get(ctx)).rejects.toHaveProperty(
        'status',
        404
      )
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
        { outgoingPaymentId: outgoingPayment.id }
      )
      await expect(outgoingPaymentRoutes.get(ctx)).resolves.toBeUndefined()
      expect(ctx.status).toBe(200)
      expect(ctx.response.get('Content-Type')).toBe(
        'application/json; charset=utf-8'
      )

      expect(ctx.body).toEqual({
        id: `${accountUrl}/outgoing-payments/${outgoingPayment.id}`,
        accountId: accountUrl,
        receivingPayment: outgoingPayment.receivingPayment,
        sendAmount: {
          ...outgoingPayment.sendAmount,
          value: outgoingPayment.sendAmount.value.toString()
        },
        receiveAmount: {
          ...outgoingPayment.receiveAmount,
          value: outgoingPayment.receiveAmount.value.toString()
        },
        state: 'processing',
        description: outgoingPayment.description,
        externalRef: outgoingPayment.externalRef
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
          { outgoingPaymentId: outgoingPayment.id }
        )
        await expect(outgoingPaymentRoutes.get(ctx)).resolves.toBeUndefined()
        expect(ctx.status).toBe(200)
        expect(ctx.body).toEqual({
          id: `${accountUrl}/outgoing-payments/${outgoingPayment.id}`,
          accountId: accountUrl,
          receivingPayment: outgoingPayment.receivingPayment,
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
          }
        })
      })
    })
  })

  describe('create', (): void => {
    let options: Omit<
      CreateOutgoingPaymentOptions & CreateQuoteOptions,
      'accountId' | 'quoteId'
    > & {
      quoteId?: string
    }

    beforeEach(() => {
      options = {
        receivingPayment
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
        message: 'invalid account id',
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
      field                 | invalidValue
      ${'receivingAccount'} | ${123}
      ${'sendAmount'}       | ${123}
      ${'receiveAmount'}    | ${123}
      ${'receivingPayment'} | ${123}
      ${'description'}      | ${123}
      ${'externalRef'}      | ${123}
    `(
      'returns error on invalid $field',
      async ({ field, invalidValue }): Promise<void> => {
        const ctx = setup({})
        ctx.request.body[field] = invalidValue
        await expect(outgoingPaymentRoutes.create(ctx)).rejects.toMatchObject({
          message: `invalid ${field}`,
          status: 400
        })
      }
    )

    test.each`
      toAccount           | toPayment
      ${receivingAccount} | ${receivingPayment}
      ${undefined}        | ${undefined}
    `(
      'returns error on invalid destination',
      async ({ receivingAccount, receivingPayment }): Promise<void> => {
        options = {
          receivingAccount,
          receivingPayment
        }
        const ctx = setup({})
        await expect(outgoingPaymentRoutes.create(ctx)).rejects.toMatchObject({
          message: 'invalid destination',
          status: 400
        })
      }
    )

    // receivingPayment and receivingAccount are defined in `beforeEach`
    // and unavailable in the `test.each` table
    test.each`
      toAccount | toPayment | sendAmount   | receiveAmount
      ${true}   | ${false}  | ${undefined} | ${undefined}
      ${true}   | ${false}  | ${123}       | ${123}
      ${false}  | ${true}   | ${123}       | ${123}
    `(
      'returns error on invalid amount',
      async ({
        toAccount,
        toPayment,
        sendAmount,
        receiveAmount
      }): Promise<void> => {
        options = {
          receivingPayment: toPayment ? receivingPayment : undefined,
          receivingAccount: toAccount ? receivingAccount : undefined,
          sendAmount: sendAmount
            ? {
                value: sendAmount,
                assetCode: asset.code,
                assetScale: asset.scale
              }
            : undefined,
          receiveAmount: receiveAmount
            ? {
                value: receiveAmount,
                assetCode: asset.code,
                assetScale: asset.scale
              }
            : undefined
        }
        const ctx = setup({})
        await expect(outgoingPaymentRoutes.create(ctx)).rejects.toMatchObject({
          message: 'invalid amount',
          status: 400
        })
      }
    )

    test('returns error on invalid sendAmount asset', async (): Promise<void> => {
      options = {
        receivingAccount,
        sendAmount: {
          ...sendAmount,
          assetScale: sendAmount.assetScale + 1
        }
      }
      const ctx = setup({})
      await expect(outgoingPaymentRoutes.create(ctx)).rejects.toMatchObject({
        message: 'invalid amount',
        status: 400
      })
    })

    describe('returns the outgoing payment on success', (): void => {
      test('Quote', async (): Promise<void> => {
        const quote = await createAccountQuote(accountId)
        options = {
          quoteId: quote.id,
          description: 'rent',
          externalRef: '202201'
        }
        const ctx = setup({})
        await expect(outgoingPaymentRoutes.create(ctx)).resolves.toBeUndefined()
        expect(ctx.response.status).toBe(201)
        const outgoingPaymentId = ((ctx.response.body as Record<
          string,
          unknown
        >)['id'] as string)
          .split('/')
          .pop()
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
          state: 'processing'
        })
      })

      test.each`
        sendAmount   | receiveAmount | expectedAmount | description
        ${'123'}     | ${undefined}  | ${'61'}        | ${'fixed-send'}
        ${undefined} | ${'56'}       | ${'114'}       | ${'fixed-receive'}
      `(
        '$description',
        async ({
          sendAmount,
          receiveAmount,
          expectedAmount
        }): Promise<void> => {
          options = {
            receivingAccount,
            sendAmount: sendAmount
              ? {
                  value: sendAmount,
                  assetCode: asset.code,
                  assetScale: asset.scale
                }
              : undefined,
            receiveAmount: receiveAmount
              ? {
                  value: receiveAmount,
                  assetCode: destinationAsset.code,
                  assetScale: destinationAsset.scale
                }
              : undefined
          }
          const ctx = setup({})
          const quoteSpy = jest
            .spyOn(quoteService, 'create')
            .mockImplementationOnce((opts) => createQuote(deps, opts))
          await expect(
            outgoingPaymentRoutes.create(ctx)
          ).resolves.toBeUndefined()
          expect(quoteSpy).toHaveBeenCalled
          expect(ctx.response.status).toBe(201)
          const outgoingPaymentId = ((ctx.response.body as Record<
            string,
            unknown
          >)['id'] as string)
            .split('/')
            .pop()
          expect(ctx.response.body).toEqual({
            id: `${accountUrl}/outgoing-payments/${outgoingPaymentId}`,
            accountId: accountUrl,
            receivingPayment: expect.any(String),
            sendAmount: {
              value: sendAmount || expectedAmount,
              assetCode: asset.code,
              assetScale: asset.scale
            },
            receiveAmount: {
              value: receiveAmount || expectedAmount,
              assetCode: destinationAsset.code,
              assetScale: destinationAsset.scale
            },
            state: 'processing'
          })
        }
      )

      test('IncomingPayment', async (): Promise<void> => {
        options = {
          receivingPayment,
          description: 'rent',
          externalRef: '202201'
        }
        const ctx = setup({})
        const quoteSpy = jest
          .spyOn(quoteService, 'create')
          .mockImplementationOnce((opts) => createQuote(deps, opts))
        await expect(outgoingPaymentRoutes.create(ctx)).resolves.toBeUndefined()
        expect(quoteSpy).toHaveBeenCalled
        expect(ctx.response.status).toBe(201)
        const outgoingPaymentId = ((ctx.response.body as Record<
          string,
          unknown
        >)['id'] as string)
          .split('/')
          .pop()
        expect(ctx.response.body).toEqual({
          id: `${accountUrl}/outgoing-payments/${outgoingPaymentId}`,
          accountId: accountUrl,
          receivingPayment,
          sendAmount: {
            ...sendAmount,
            value: Math.ceil(
              Number(incomingPayment.incomingAmount?.value) *
                2 *
                (1 + config.slippage)
            ).toString()
          },
          receiveAmount: {
            ...incomingPayment.incomingAmount,
            value: incomingPayment.incomingAmount?.value.toString()
          },
          description: options.description,
          externalRef: options.externalRef,
          state: 'processing'
        })
      })
    })
  })
})
