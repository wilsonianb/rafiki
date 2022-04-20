import assert from 'assert'
import Axios from 'axios'
import nock, { Definition } from 'nock'
import Knex from 'knex'
import * as Pay from '@interledger/pay'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'

import {
  FundingError,
  LifecycleError,
  OutgoingPaymentError,
  isOutgoingPaymentError
} from './errors'
import { OutgoingPaymentService, CreateOutgoingPaymentOptions } from './service'
import {
  createTestApp,
  TestContainer,
  testAccessToken
} from '../../../tests/app'
import { IAppConfig, Config } from '../../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../../'
import { AppServices } from '../../../app'
import { truncateTables } from '../../../tests/tableManager'
import {
  OutgoingPayment,
  OutgoingPaymentState,
  PaymentEvent,
  PaymentEventType
} from './model'
import { RETRY_BACKOFF_SECONDS } from './worker'
import { isTransferError } from '../../../accounting/errors'
import { AccountingService, TransferOptions } from '../../../accounting/service'
import { AssetOptions } from '../../../asset/service'
import { IncomingPayment } from '../incoming/model'
import { QuoteService, CreateQuoteOptions } from '../../quote/service'
import { isQuoteError } from '../../quote/errors'
import { Quote } from '../../quote/model'
import { Pagination } from '../../../shared/baseModel'
import { getPageTests } from '../../../shared/baseModel.test'
import { Amount } from '../amount'
import { isIncomingPaymentError } from '../incoming/errors'

describe('OutgoingPaymentService', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let outgoingPaymentService: OutgoingPaymentService
  let accountingService: AccountingService
  let quoteService: QuoteService
  let knex: Knex
  let accountId: string
  let incomingPayment: IncomingPayment
  let receivingPayment: string
  let accountUrl: string
  let receivingAccount: string
  let amtDelivered: bigint
  let config: IAppConfig

  const asset: AssetOptions = {
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

  const receiveAmount: Amount = {
    value: BigInt(56),
    assetCode: destinationAsset.code,
    assetScale: destinationAsset.scale
  }

  const webhookTypes: {
    [key in OutgoingPaymentState]: PaymentEventType | undefined
  } = {
    [OutgoingPaymentState.Pending]: undefined,
    [OutgoingPaymentState.Funding]: PaymentEventType.PaymentCreated,
    [OutgoingPaymentState.Sending]: undefined,
    [OutgoingPaymentState.Failed]: PaymentEventType.PaymentFailed,
    [OutgoingPaymentState.Completed]: PaymentEventType.PaymentCompleted
  }

  function mockWalletQuote(): nock.Scope {
    const quoteUrl = new URL(Config.quoteUrl)
    return nock(quoteUrl.origin)
      .matchHeader('Accept', 'application/json')
      .matchHeader('Content-Type', 'application/json')
      .post(quoteUrl.pathname)
      .reply(
        201,
        function (_path: string, requestBody: Record<string, unknown>) {
          return requestBody
        }
      )
  }

  async function createQuote(options: CreateQuoteOptions): Promise<Quote> {
    const scope = mockWalletQuote()
    const quote = await quoteService.create(options)
    scope.isDone()
    assert.ok(!isQuoteError(quote))
    return quote
  }

  async function createPayment(
    options: CreateOutgoingPaymentOptions
  ): Promise<OutgoingPayment> {
    // TODO: mock wallet quote and create incoming payment depending on options...
    const payment = await outgoingPaymentService.create(options)
    assert.ok(!isOutgoingPaymentError(payment))
    return payment
  }

  async function processNext(
    paymentId: string,
    expectState: OutgoingPaymentState,
    expectedError?: string
  ): Promise<OutgoingPayment> {
    await expect(outgoingPaymentService.processNext()).resolves.toBe(paymentId)
    const payment = await outgoingPaymentService.get(paymentId)
    if (!payment) throw 'no payment'
    if (expectState) expect(payment.state).toBe(expectState)
    expect(payment.error).toEqual(expectedError || null)
    const type = webhookTypes[payment.state]
    if (type) {
      await expect(
        PaymentEvent.query(knex).where({
          type
        })
      ).resolves.not.toHaveLength(0)
    }
    return payment
  }

  function mockCreateIncomingPayment(receiveAmount?: Amount): nock.Scope {
    const incomingPaymentsUrl = new URL(`${accountUrl}/incoming-payments`)
    return nock(incomingPaymentsUrl.origin)
      .post(incomingPaymentsUrl.pathname, function (this: Definition, body) {
        expect(body.incomingAmount).toEqual(
          receiveAmount
            ? {
                value: receiveAmount.value.toString(),
                assetCode: receiveAmount.assetCode,
                assetScale: receiveAmount.assetScale
              }
            : undefined
        )
        return true
      })
      .matchHeader('Accept', 'application/json')
      .matchHeader('Content-Type', 'application/json')
      .reply(201, function (path, requestBody) {
        return Axios.post(
          `http://localhost:${appContainer.port}${path}`,
          requestBody,
          {
            headers: Object.assign(
              { Authorization: `GNAP ${testAccessToken}` },
              this.req.headers
            )
          }
        ).then((res) => res.data)
      })
  }

  function mockPay(
    extendQuote: Partial<Pay.Quote>,
    error?: Pay.PaymentError
  ): jest.SpyInstance<Promise<Pay.PaymentProgress>, [options: Pay.PayOptions]> {
    const { pay } = Pay
    return jest
      .spyOn(Pay, 'pay')
      .mockImplementation(async (opts: Pay.PayOptions) => {
        const res = await pay({
          ...opts,
          quote: { ...opts.quote, ...extendQuote }
        })
        if (error) res.error = error
        return res
      })
  }

  // Mock the time to fast-forward to the time that the specified (absolute, not relative) attempt is scheduled.
  function fastForwardToAttempt(stateAttempts: number): void {
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(
        Date.now() + stateAttempts * RETRY_BACKOFF_SECONDS * 1000
      )
  }

  async function payIncomingPayment(amount: bigint): Promise<void> {
    await expect(
      accountingService.createDeposit({
        id: uuid(),
        account: incomingPayment,
        amount
      })
    ).resolves.toBeUndefined()
  }

  function trackAmountDelivered(sourceAccountId: string): void {
    const { createTransfer } = accountingService
    jest
      .spyOn(accountingService, 'createTransfer')
      .mockImplementation(async (options: TransferOptions) => {
        const trxOrError = await createTransfer(options)
        if (
          !isTransferError(trxOrError) &&
          options.sourceAccount.id === sourceAccountId
        ) {
          amtDelivered += options.destinationAmount || options.sourceAmount
        }
        return trxOrError
      })
  }

  async function expectOutcome(
    payment: OutgoingPayment,
    {
      amountSent,
      amountDelivered,
      accountBalance,
      incomingPaymentReceived,
      withdrawAmount
    }: {
      amountSent?: bigint
      amountDelivered?: bigint
      accountBalance?: bigint
      incomingPaymentReceived?: bigint
      withdrawAmount?: bigint
    }
  ) {
    if (amountSent !== undefined) {
      await expect(accountingService.getTotalSent(payment.id)).resolves.toBe(
        amountSent
      )
    }
    if (amountDelivered !== undefined) {
      expect(amtDelivered).toEqual(amountDelivered)
    }
    if (accountBalance !== undefined) {
      await expect(accountingService.getBalance(payment.id)).resolves.toEqual(
        accountBalance
      )
    }
    if (incomingPaymentReceived !== undefined) {
      await expect(
        accountingService.getTotalReceived(incomingPayment.id)
      ).resolves.toEqual(incomingPaymentReceived)
    }
    if (withdrawAmount !== undefined) {
      await expect(
        PaymentEvent.query(knex).where({
          withdrawalAccountId: payment.id,
          withdrawalAmount: withdrawAmount
        })
      ).resolves.toHaveLength(1)
    }
  }

  beforeAll(
    async (): Promise<void> => {
      Config.pricesUrl = 'https://test.prices'
      nock(Config.pricesUrl)
        .get('/')
        .reply(200, () => ({
          USD: 1.0, // base
          XRP: 2.0
        }))
        .persist()
      deps = await initIocContainer(Config)
      appContainer = await createTestApp(deps)
      accountingService = await deps.use('accountingService')
      quoteService = await deps.use('quoteService')

      knex = await deps.use('knex')
      config = await deps.use('config')
    }
  )

  beforeEach(
    async (): Promise<void> => {
      outgoingPaymentService = await deps.use('outgoingPaymentService')
      const accountService = await deps.use('accountService')
      accountId = (
        await accountService.create({
          asset: {
            code: sendAmount.assetCode,
            scale: sendAmount.assetScale
          }
        })
      ).id
      const destinationAccount = await accountService.create({
        asset: destinationAsset
      })
      await expect(
        accountingService.createDeposit({
          id: uuid(),
          account: destinationAccount.asset,
          amount: BigInt(123)
        })
      ).resolves.toBeUndefined()
      accountUrl = `${config.publicHost}/${destinationAccount.id}`
      receivingAccount = accountUrl.replace('https://', '$')
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
      receivingPayment = `${accountUrl}/incoming-payments/${incomingPayment.id}`
      amtDelivered = BigInt(0)
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
      await appContainer.shutdown()
    }
  )

  describe('get', (): void => {
    it('returns undefined when no payment exists', async () => {
      await expect(outgoingPaymentService.get(uuid())).resolves.toBeUndefined()
    })
  })

  describe('create', (): void => {
    it('creates an OutgoingPayment from a quote', async () => {
      const quote = await createQuote({
        accountId,
        receivingPayment
      })
      const options = {
        accountId,
        quoteId: quote.id,
        description: 'rent',
        externalRef: '202201'
      }
      const payment = await outgoingPaymentService.create(options)
      assert.ok(!isOutgoingPaymentError(payment))
      expect(payment).toMatchObject({
        id: quote.id,
        accountId,
        receivingPayment,
        sendAmount: quote.sendAmount,
        receiveAmount: quote.receiveAmount,
        description: options.description,
        externalRef: options.externalRef,
        state: OutgoingPaymentState.Funding,
        asset,
        quote
      })
      await expectOutcome(payment, { accountBalance: BigInt(0) })

      await expect(outgoingPaymentService.get(payment.id)).resolves.toEqual(
        payment
      )
    })

    it('creates an OutgoingPayment to account (FixedSend)', async () => {
      const options = {
        accountId,
        receivingAccount,
        sendAmount,
        description: 'rent',
        externalRef: '202201'
      }
      const paymentScope = mockCreateIncomingPayment()
      const quoteScope = mockWalletQuote()
      const payment = await outgoingPaymentService.create(options)
      paymentScope.isDone()
      quoteScope.isDone()
      assert.ok(!isOutgoingPaymentError(payment))
      expect(payment).toMatchObject({
        id: payment.quote.id,
        accountId,
        state: OutgoingPaymentState.Funding,
        sendAmount,
        receiveAmount: payment.quote.receiveAmount,
        receivingPayment: payment.quote.receivingPayment,
        description: options.description,
        externalRef: options.externalRef,
        asset,
        quote: {
          accountId,
          sendAmount,
          receiveAmount: {
            value: BigInt(
              Math.ceil(
                Number(sendAmount.value) *
                  payment.quote.minExchangeRate.valueOf()
              )
            ),
            assetCode: destinationAsset.code,
            assetScale: destinationAsset.scale
          },
          maxPacketAmount: BigInt('9223372036854775807')
        }
      })

      expect(payment.quote.minExchangeRate.valueOf()).toBe(
        0.5 * (1 - config.slippage)
      )
      expect(payment.quote.lowEstimatedExchangeRate.valueOf()).toBe(0.5)
      expect(payment.quote.highEstimatedExchangeRate.valueOf()).toBe(
        0.500000000001
      )

      await expectOutcome(payment, { accountBalance: BigInt(0) })

      await expect(outgoingPaymentService.get(payment.id)).resolves.toEqual(
        payment
      )
      await expect(quoteService.get(payment.id)).resolves.toEqual(payment.quote)
    })

    it('creates an OutgoingPayment to account (FixedDelivery)', async () => {
      const options = {
        accountId,
        receivingAccount,
        receiveAmount
      }
      const paymentScope = mockCreateIncomingPayment(receiveAmount)
      const quoteScope = mockWalletQuote()
      const payment = await outgoingPaymentService.create(options)
      paymentScope.isDone()
      quoteScope.isDone()
      assert.ok(!isOutgoingPaymentError(payment))
      expect(payment).toMatchObject({
        id: payment.quote.id,
        accountId,
        state: OutgoingPaymentState.Funding,
        sendAmount: payment.quote.sendAmount,
        receiveAmount,
        receivingPayment: payment.quote.receivingPayment,
        description: null,
        externalRef: null,
        asset,
        quote: {
          accountId,
          sendAmount: {
            value: BigInt(
              Math.ceil(Number(receiveAmount.value) * 2 * (1 + config.slippage))
            ),
            assetCode: asset.code,
            assetScale: asset.scale
          },
          receiveAmount,
          maxPacketAmount: BigInt('9223372036854775807')
        }
      })

      expect(payment.quote.minExchangeRate.valueOf()).toBe(
        0.5 * (1 - config.slippage)
      )
      expect(payment.quote.lowEstimatedExchangeRate.valueOf()).toBe(0.5)
      expect(payment.quote.highEstimatedExchangeRate.valueOf()).toBe(
        0.500000000001
      )

      await expectOutcome(payment, { accountBalance: BigInt(0) })

      await expect(outgoingPaymentService.get(payment.id)).resolves.toEqual(
        payment
      )
      await expect(quoteService.get(payment.id)).resolves.toEqual(payment.quote)
    })

    it('creates an OutgoingPayment to incoming payment (FixedDelivery)', async () => {
      const options = {
        accountId,
        receivingPayment
      }
      const paymentScope = mockCreateIncomingPayment(receiveAmount)
      const quoteScope = mockWalletQuote()
      const payment = await outgoingPaymentService.create(options)
      paymentScope.isDone()
      quoteScope.isDone()
      assert.ok(!isOutgoingPaymentError(payment))
      expect(payment).toMatchObject({
        id: payment.quote.id,
        accountId,
        state: OutgoingPaymentState.Funding,
        sendAmount: payment.quote.sendAmount,
        receiveAmount,
        receivingPayment: payment.quote.receivingPayment,
        description: null,
        externalRef: null,
        asset,
        quote: {
          accountId,
          sendAmount: {
            value: BigInt(
              Math.ceil(
                Number(incomingPayment.incomingAmount?.value) *
                  2 *
                  (1 + config.slippage)
              )
            ),
            assetCode: asset.code,
            assetScale: asset.scale
          },
          receiveAmount,
          maxPacketAmount: BigInt('9223372036854775807')
        }
      })

      expect(payment.quote.minExchangeRate.valueOf()).toBe(
        0.5 * (1 - config.slippage)
      )
      expect(payment.quote.lowEstimatedExchangeRate.valueOf()).toBe(0.5)
      expect(payment.quote.highEstimatedExchangeRate.valueOf()).toBe(
        0.500000000001
      )

      await expectOutcome(payment, { accountBalance: BigInt(0) })

      await expect(outgoingPaymentService.get(payment.id)).resolves.toEqual(
        payment
      )
      await expect(quoteService.get(payment.id)).resolves.toEqual(payment.quote)
    })

    it('fails to create on unknown quote', async () => {
      await expect(
        outgoingPaymentService.create({
          accountId,
          quoteId: uuid()
        })
      ).resolves.toEqual(OutgoingPaymentError.UnknownQuote)
    })

    it('fails to create on unknown account', async () => {
      const quote = await createQuote({
        accountId,
        receivingPayment
      })
      await expect(
        outgoingPaymentService.create({
          accountId: uuid(),
          quoteId: quote.id
        })
      ).resolves.toEqual(OutgoingPaymentError.UnknownAccount)
    })

    // it('fails to create on conflicting quote account', async () => {
    // })

    // receivingPayment and receivingAccount are defined in `beforeEach`
    // and unavailable in the `test.each` table
    test.each`
      toPayment | toAccount | sendAmount                              | receiveAmount                              | error                                      | description
      ${false}  | ${false}  | ${sendAmount}                           | ${undefined}                               | ${OutgoingPaymentError.InvalidDestination} | ${'without a destination'}
      ${true}   | ${true}   | ${sendAmount}                           | ${undefined}                               | ${OutgoingPaymentError.InvalidDestination} | ${'with multiple destinations'}
      ${false}  | ${true}   | ${undefined}                            | ${undefined}                               | ${OutgoingPaymentError.InvalidAmount}      | ${'with missing amount'}
      ${false}  | ${true}   | ${sendAmount}                           | ${receiveAmount}                           | ${OutgoingPaymentError.InvalidAmount}      | ${'with multiple amounts'}
      ${false}  | ${true}   | ${{ ...sendAmount, value: BigInt(0) }}  | ${undefined}                               | ${OutgoingPaymentError.InvalidAmount}      | ${'sendAmount of zero'}
      ${false}  | ${true}   | ${{ ...sendAmount, value: BigInt(-1) }} | ${undefined}                               | ${OutgoingPaymentError.InvalidAmount}      | ${'negative sendAmount'}
      ${false}  | ${true}   | ${undefined}                            | ${{ ...receiveAmount, value: BigInt(0) }}  | ${OutgoingPaymentError.InvalidAmount}      | ${'receiveAmount of zero'}
      ${false}  | ${true}   | ${undefined}                            | ${{ ...receiveAmount, value: BigInt(-1) }} | ${OutgoingPaymentError.InvalidAmount}      | ${'negative receiveAmount'}
    `(
      'fails to create $description',
      async ({
        toPayment,
        toAccount,
        sendAmount,
        receiveAmount,
        error
      }): Promise<void> => {
        await expect(
          outgoingPaymentService.create({
            accountId,
            receivingPayment: toPayment ? receivingPayment : undefined,
            receivingAccount: toAccount ? receivingAccount : undefined,
            sendAmount,
            receiveAmount
          })
        ).resolves.toEqual(error)
      }
    )
  })

  describe('processNext', (): void => {
    // Maybe another person or payment paid the incoming payment already.
    // it('FAILED (FixedDelivery, incoming payment was already full paid)', async (): Promise<void> => {
    //   const paymentId = (
    //     await createPayment({
    //       accountId,
    //       receivingPayment: receivingPayment
    //     })
    //   ).id
    //   // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    //   await payIncomingPayment(incomingPayment.incomingAmount!.value)
    //   await processNext(
    //     paymentId,
    //     OutgoingPaymentState.Failed,
    //     Pay.PaymentError.IncomingPaymentCompleted
    //   )
    // })

    // it('FAILED (source asset changed)', async (): Promise<void> => {
    //   const { id: paymentId } = await createPayment({
    //     accountId,
    //     receivingAccount,
    //     sendAmount
    //   })
    //   const assetService = await deps.use('assetService')
    //   const { id: assetId } = await assetService.getOrCreate({
    //     code: asset.code,
    //     scale: asset.scale + 1
    //   })
    //   await OutgoingPayment.relatedQuery('account').for(paymentId).patch({
    //     assetId
    //   })

    //   const scope = mockCreateIncomingPayment()
    //   await processNext(
    //     paymentId,
    //     OutgoingPaymentState.Failed,
    //     LifecycleError.SourceAssetConflict
    //   )
    //   scope.isDone()
    // })

    describe('SENDING→', (): void => {
      async function setup(
        opts: Pick<
          CreateOutgoingPaymentOptions,
          | 'sendAmount'
          | 'receivingAccount'
          | 'receivingPayment'
          | 'receiveAmount'
        >
      ): Promise<string> {
        const { id: paymentId } = await createPayment({
          accountId,
          ...opts
        })

        trackAmountDelivered(paymentId)

        const scope =
          opts.receivingAccount && mockCreateIncomingPayment(opts.receiveAmount)
        const payment = await processNext(
          paymentId,
          OutgoingPaymentState.Funding
        )
        if (opts.receivingAccount) {
          ;(scope as nock.Scope).isDone()
        }
        assert.ok(payment.sendAmount)
        await expect(
          outgoingPaymentService.fund({
            id: paymentId,
            amount: payment.sendAmount.value,
            transferId: uuid()
          })
        ).resolves.toMatchObject({
          state: OutgoingPaymentState.Sending
        })

        return paymentId
      }

      it('COMPLETED', async (): Promise<void> => {
        const paymentId = await setup({
          receivingPayment: receivingPayment
        })

        const payment = await processNext(
          paymentId,
          OutgoingPaymentState.Completed
        )
        if (!payment.sendAmount) throw 'no sendAmount'
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const amountSent = incomingPayment.incomingAmount!.value * BigInt(2)
        await expectOutcome(payment, {
          accountBalance: payment.sendAmount.value - amountSent,
          amountSent,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          amountDelivered: incomingPayment.incomingAmount!.value,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          incomingPaymentReceived: incomingPayment.incomingAmount!.value,
          withdrawAmount: payment.sendAmount.value - amountSent
        })
      })

      it('COMPLETED (with incoming payment initially partially paid)', async (): Promise<void> => {
        const amountAlreadyDelivered = BigInt(34)
        await payIncomingPayment(amountAlreadyDelivered)
        const paymentId = await setup({
          receivingPayment: receivingPayment
        })

        const payment = await processNext(
          paymentId,
          OutgoingPaymentState.Completed
        )
        if (!payment.sendAmount) throw 'no sendAmount'
        const amountSent =
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          (incomingPayment.incomingAmount!.value - amountAlreadyDelivered) *
          BigInt(2)
        await expectOutcome(payment, {
          accountBalance: payment.sendAmount.value - amountSent,
          amountSent,
          amountDelivered:
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            incomingPayment.incomingAmount!.value - amountAlreadyDelivered,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          incomingPaymentReceived: incomingPayment.incomingAmount!.value,
          withdrawAmount: payment.sendAmount.value - amountSent
        })
      })

      it('SENDING (partial payment then retryable Pay error)', async (): Promise<void> => {
        mockPay(
          {
            maxSourceAmount: BigInt(10),
            minDeliveryAmount: BigInt(5)
          },
          Pay.PaymentError.ClosedByReceiver
        )

        const paymentId = await setup({
          receivingAccount,
          sendAmount
        })

        for (let i = 0; i < 4; i++) {
          const payment = await processNext(
            paymentId,
            OutgoingPaymentState.Sending
          )
          expect(payment.stateAttempts).toBe(i + 1)
          await expectOutcome(payment, {
            amountSent: BigInt(10 * (i + 1)),
            amountDelivered: BigInt(5 * (i + 1))
          })
          // Skip through the backoff timer.
          fastForwardToAttempt(payment.stateAttempts)
        }
        // Last attempt fails, but no more retries.
        const payment = await processNext(
          paymentId,
          OutgoingPaymentState.Failed,
          Pay.PaymentError.ClosedByReceiver
        )
        expect(payment.stateAttempts).toBe(0)
        // "mockPay" allows a small amount of money to be paid every attempt.
        await expectOutcome(payment, {
          accountBalance: BigInt(123 - 10 * 5),
          amountSent: BigInt(10 * 5),
          amountDelivered: BigInt(5 * 5),
          withdrawAmount: BigInt(123 - 10 * 5)
        })
      })

      it('FAILED (non-retryable Pay error)', async (): Promise<void> => {
        mockPay(
          {
            maxSourceAmount: BigInt(10),
            minDeliveryAmount: BigInt(5)
          },
          Pay.PaymentError.ReceiverProtocolViolation
        )
        const paymentId = await setup({
          receivingAccount,
          sendAmount
        })

        const payment = await processNext(
          paymentId,
          OutgoingPaymentState.Failed,
          Pay.PaymentError.ReceiverProtocolViolation
        )
        await expectOutcome(payment, {
          accountBalance: BigInt(123 - 10),
          amountSent: BigInt(10),
          amountDelivered: BigInt(5),
          withdrawAmount: BigInt(123 - 10)
        })
      })

      it('SENDING→COMPLETED (partial payment, resume, complete)', async (): Promise<void> => {
        const mockFn = mockPay(
          {
            maxSourceAmount: BigInt(10),
            minDeliveryAmount: BigInt(5)
          },
          Pay.PaymentError.ClosedByReceiver
        )
        const paymentId = await setup({
          receivingAccount,
          sendAmount
        })

        const payment = await processNext(
          paymentId,
          OutgoingPaymentState.Sending
        )
        mockFn.mockRestore()
        fastForwardToAttempt(1)
        await expectOutcome(payment, {
          accountBalance: BigInt(123 - 10),
          amountSent: BigInt(10),
          amountDelivered: BigInt(5)
        })

        // The next attempt is without the mock, so it succeeds.
        const payment2 = await processNext(
          paymentId,
          OutgoingPaymentState.Completed
        )
        await expectOutcome(payment2, {
          accountBalance: BigInt(0),
          amountSent: sendAmount.value,
          amountDelivered: sendAmount.value / BigInt(2)
        })
      })

      // Caused by retry after failed SENDING→COMPLETED transition commit.
      it('COMPLETED (FixedSend, already fully paid)', async (): Promise<void> => {
        const paymentId = await setup({
          receivingAccount,
          sendAmount
        })

        await processNext(paymentId, OutgoingPaymentState.Completed)
        // Pretend that the transaction didn't commit.
        await OutgoingPayment.query(knex)
          .findById(paymentId)
          .patch({ state: OutgoingPaymentState.Sending })
        const payment = await processNext(
          paymentId,
          OutgoingPaymentState.Completed
        )
        await expectOutcome(payment, {
          accountBalance: BigInt(0),
          amountSent: BigInt(123),
          amountDelivered: BigInt(123) / BigInt(2)
        })
      })

      // Caused by retry after failed SENDING→COMPLETED transition commit.
      it('COMPLETED (already fully paid)', async (): Promise<void> => {
        const paymentId = await setup({
          receivingPayment: receivingPayment
        })
        // The quote thinks there's a full amount to pay, but actually sending will find the incoming payment has been paid (e.g. by another payment).
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await payIncomingPayment(incomingPayment.incomingAmount!.value)

        const payment = await processNext(
          paymentId,
          OutgoingPaymentState.Completed
        )
        if (!payment.sendAmount) throw 'no sendAmount'
        await expectOutcome(payment, {
          accountBalance: payment.sendAmount.value,
          amountSent: BigInt(0),
          amountDelivered: BigInt(0),
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          incomingPaymentReceived: incomingPayment.incomingAmount!.value,
          withdrawAmount: payment.sendAmount.value
        })
      })

      it('FAILED (source asset changed)', async (): Promise<void> => {
        const paymentId = await setup({
          receivingPayment: receivingPayment
        })
        const assetService = await deps.use('assetService')
        const { id: assetId } = await assetService.getOrCreate({
          code: asset.code,
          scale: asset.scale + 1
        })
        await OutgoingPayment.relatedQuery('account').for(paymentId).patch({
          assetId
        })

        await processNext(
          paymentId,
          OutgoingPaymentState.Failed,
          LifecycleError.SourceAssetConflict
        )
      })

      it('FAILED (destination asset changed)', async (): Promise<void> => {
        const paymentId = await setup({
          receivingPayment: receivingPayment
        })
        // Pretend that the destination asset was initially different.
        await OutgoingPayment.query(knex)
          .findById(paymentId)
          .patch({
            receiveAmount: {
              value: BigInt(56),
              assetCode: incomingPayment.asset.code,
              assetScale: 55
            }
          })

        await processNext(
          paymentId,
          OutgoingPaymentState.Failed,
          Pay.PaymentError.DestinationAssetConflict
        )
      })
    })
  })

  describe('fund', (): void => {
    let payment: OutgoingPayment
    let quoteAmount: bigint

    beforeEach(async (): Promise<void> => {
      const quote = await createQuote({
        accountId,
        receivingPayment
      })
      payment = await createPayment({
        accountId,
        quoteId: quote.id
      })
      quoteAmount = quote.sendAmount.value
      await expectOutcome(payment, { accountBalance: BigInt(0) })
    }, 10_000)

    it('fails when no payment exists', async (): Promise<void> => {
      await expect(
        outgoingPaymentService.fund({
          id: uuid(),
          amount: quoteAmount,
          transferId: uuid()
        })
      ).resolves.toEqual(FundingError.UnknownPayment)
    })

    it('transitions a Funding payment to Sending state', async (): Promise<void> => {
      await expect(
        outgoingPaymentService.fund({
          id: payment.id,
          amount: quoteAmount,
          transferId: uuid()
        })
      ).resolves.toMatchObject({
        id: payment.id,
        state: OutgoingPaymentState.Sending
      })

      const after = await outgoingPaymentService.get(payment.id)
      expect(after?.state).toBe(OutgoingPaymentState.Sending)
      await expectOutcome(payment, { accountBalance: quoteAmount })
    })

    it('fails for invalid funding amount', async (): Promise<void> => {
      await expect(
        outgoingPaymentService.fund({
          id: payment.id,
          amount: quoteAmount - BigInt(1),
          transferId: uuid()
        })
      ).resolves.toEqual(FundingError.InvalidAmount)

      const after = await outgoingPaymentService.get(payment.id)
      expect(after?.state).toBe(OutgoingPaymentState.Funding)
      await expectOutcome(payment, { accountBalance: BigInt(0) })
    })

    Object.values(OutgoingPaymentState).forEach((startState) => {
      if (startState === OutgoingPaymentState.Funding) return
      it(`does not fund a ${startState} payment`, async (): Promise<void> => {
        await payment.$query().patch({ state: startState })
        await expect(
          outgoingPaymentService.fund({
            id: payment.id,
            amount: quoteAmount,
            transferId: uuid()
          })
        ).resolves.toEqual(FundingError.WrongState)

        const after = await outgoingPaymentService.get(payment.id)
        expect(after?.state).toBe(startState)
      })
    })
  })

  describe('getAccountPage', (): void => {
    getPageTests({
      createModel: () =>
        createPayment({
          accountId,
          receivingAccount,
          sendAmount
        }),
      getPage: (pagination: Pagination) =>
        outgoingPaymentService.getAccountPage(accountId, pagination)
    })
  })
})
