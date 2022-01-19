import assert from 'assert'
import nock from 'nock'
import Knex from 'knex'
import * as Pay from '@interledger/pay'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'

import { OutgoingPaymentService } from './service'
import { createTestApp, TestContainer } from '../tests/app'
import { IAppConfig, Config } from '../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../'
import { AppServices } from '../app'
import { PaymentFactory } from '../tests/paymentFactory'
import { truncateTable, truncateTables } from '../tests/tableManager'
import { OutgoingPayment, PaymentIntent, PaymentState } from './model'
import { CreateError, isCreateError, LifecycleError } from './errors'
import { RETRY_BACKOFF_SECONDS } from './worker'
import { isTransferError } from '../accounting/errors'
import { AccountingService, TransferOptions } from '../accounting/service'
import { AssetOptions } from '../asset/service'
import { Invoice } from '../open_payments/invoice/model'
import { RatesService } from '../rates/service'
import { EventType } from '../webhook/service'

describe('OutgoingPaymentService', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let outgoingPaymentService: OutgoingPaymentService
  let ratesService: RatesService
  let accountingService: AccountingService
  let paymentFactory: PaymentFactory
  let knex: Knex
  let accountId: string
  let asset: AssetOptions
  let invoice: Invoice
  let invoiceUrl: string
  let accountUrl: string
  let paymentPointer: string
  let amtDelivered: bigint
  let config: IAppConfig

  const webhookUrl = new URL(Config.webhookUrl)

  enum WebhookState {
    Funding = PaymentState.Funding,
    Cancelled = PaymentState.Cancelled,
    Completed = PaymentState.Completed
  }

  const isWebhookState = (state: PaymentState): boolean =>
    Object.values(WebhookState).includes(state)

  const webhookTypes: {
    [key in WebhookState]: EventType
  } = {
    [WebhookState.Funding]: EventType.PaymentFunding,
    [WebhookState.Cancelled]: EventType.PaymentCancelled,
    [WebhookState.Completed]: EventType.PaymentCompleted
  }

  function mockWebhookServer(
    paymentId: string,
    state: PaymentState,
    status = 200
  ): nock.Scope {
    assert.ok(isWebhookState(state))
    return nock(webhookUrl.origin)
      .post(webhookUrl.pathname, (body): boolean => {
        expect(body.type).toEqual(webhookTypes[state])
        expect(body.data.payment.id).toEqual(paymentId)
        expect(body.data.payment.state).toEqual(state)
        return true
      })
      .reply(status)
  }

  async function processNext(
    paymentId: string,
    expectState: PaymentState,
    expectedError?: string
  ): Promise<OutgoingPayment> {
    await expect(outgoingPaymentService.processNext()).resolves.toBe(paymentId)
    const payment = await outgoingPaymentService.get(paymentId)
    if (!payment) throw 'no payment'
    if (expectState) expect(payment.state).toBe(expectState)
    expect(payment.error).toEqual(expectedError || null)
    return payment
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

  async function payInvoice(amount: bigint): Promise<void> {
    await expect(
      accountingService.createDeposit({
        id: uuid(),
        accountId: invoice.id,
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
      invoiceReceived
    }: {
      amountSent?: bigint
      amountDelivered?: bigint
      accountBalance?: bigint
      invoiceReceived?: bigint
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
    if (invoiceReceived !== undefined) {
      await expect(
        accountingService.getTotalReceived(invoice.id)
      ).resolves.toEqual(invoiceReceived)
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
      ratesService = await deps.use('ratesService')
      paymentFactory = new PaymentFactory(deps)

      asset = {
        scale: 9,
        code: 'USD'
      }

      knex = await deps.use('knex')
      config = await deps.use('config')
    }
  )

  beforeEach(
    async (): Promise<void> => {
      outgoingPaymentService = await deps.use('outgoingPaymentService')
      const accountService = await deps.use('accountService')
      accountId = (await accountService.create({ asset })).id
      const destinationAsset = {
        scale: 9,
        code: 'XRP'
      }
      const destinationAccount = await accountService.create({
        asset: destinationAsset
      })
      await expect(
        accountingService.createDeposit({
          id: uuid(),
          asset: {
            unit: destinationAccount.asset.unit
          },
          amount: BigInt(123)
        })
      ).resolves.toBeUndefined()
      accountUrl = `${config.publicHost}/pay/${destinationAccount.id}`
      paymentPointer = accountUrl.replace('https://', '$')
      const invoiceService = await deps.use('invoiceService')
      invoice = await invoiceService.create({
        accountId: destinationAccount.id,
        amount: BigInt(56),
        expiresAt: new Date(Date.now() + 60 * 1000),
        description: 'description!'
      })
      invoiceUrl = `${config.publicHost}/invoices/${invoice.id}`
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
    it('creates an OutgoingPayment (FixedSend)', async () => {
      const payment = await outgoingPaymentService.create({
        accountId,
        paymentPointer,
        amountToSend: BigInt(123)
      })
      assert.ok(!isCreateError(payment))
      expect(payment.state).toEqual(PaymentState.Quoting)
      expect(payment.intent).toEqual({
        paymentPointer,
        amountToSend: BigInt(123)
      })
      expect(payment.accountId).toBe(accountId)
      await expectOutcome(payment, { accountBalance: BigInt(0) })
      expect(payment.account.asset.code).toBe('USD')
      expect(payment.account.asset.scale).toBe(9)
      expect(payment.destinationAccount).toEqual({
        scale: 9,
        code: 'XRP',
        url: accountUrl
      })

      const payment2 = await outgoingPaymentService.get(payment.id)
      if (!payment2) throw 'no payment'
      expect(payment2.id).toEqual(payment.id)
    })

    it('creates an OutgoingPayment (FixedDelivery)', async () => {
      const maxSourceAmount = BigInt(123)
      const payment = await outgoingPaymentService.create({
        accountId,
        invoiceUrl,
        maxSourceAmount
      })
      assert.ok(!isCreateError(payment))
      expect(payment.state).toEqual(PaymentState.Quoting)
      expect(payment.intent).toEqual({
        invoiceUrl,
        maxSourceAmount
      })
      expect(payment.accountId).toBe(accountId)
      await expectOutcome(payment, { accountBalance: BigInt(0) })
      expect(payment.account.asset.code).toBe('USD')
      expect(payment.account.asset.scale).toBe(9)
      expect(payment.destinationAccount).toEqual({
        scale: invoice.account.asset.scale,
        code: invoice.account.asset.code,
        url: accountUrl
      })

      const payment2 = await outgoingPaymentService.get(payment.id)
      if (!payment2) throw 'no payment'
      expect(payment2.id).toEqual(payment.id)
    })

    it('fails to create with nonexistent account', async () => {
      await expect(
        outgoingPaymentService.create({
          accountId: uuid(),
          paymentPointer,
          amountToSend: BigInt(123)
        })
      ).resolves.toEqual(CreateError.UnknownAccount)
    })
  })

  describe('processNext', (): void => {
    describe('QUOTING→', (): void => {
      it('FUNDING (FixedSend)', async (): Promise<void> => {
        const paymentId = (
          await paymentFactory.build({
            accountId,
            paymentPointer,
            amountToSend: BigInt(123)
          })
        ).id
        const payment = await processNext(paymentId, PaymentState.Funding)
        if (!payment.quote) throw 'no quote'

        expect(payment.quote.timestamp).toBeInstanceOf(Date)
        expect(
          payment.quote.activationDeadline.getTime() - Date.now()
        ).toBeGreaterThan(0)
        expect(
          payment.quote.activationDeadline.getTime() - Date.now()
        ).toBeLessThanOrEqual(config.quoteLifespan)
        expect(payment.quote.targetType).toBe(Pay.PaymentType.FixedSend)
        expect(payment.quote.minDeliveryAmount).toBe(
          BigInt(Math.ceil(123 * payment.quote.minExchangeRate.valueOf()))
        )
        expect(payment.quote.maxSourceAmount).toBe(BigInt(123))
        expect(payment.quote.maxPacketAmount).toBe(
          BigInt('9223372036854775807')
        )
        expect(payment.quote.minExchangeRate.valueOf()).toBe(
          0.5 * (1 - config.slippage)
        )
        expect(payment.quote.lowExchangeRateEstimate.valueOf()).toBe(0.5)
        expect(payment.quote.highExchangeRateEstimate.valueOf()).toBe(
          0.500000000001
        )
      })

      it('FUNDING (FixedDelivery)', async (): Promise<void> => {
        const paymentId = (
          await paymentFactory.build({
            accountId,
            invoiceUrl
          })
        ).id
        const payment = await processNext(paymentId, PaymentState.Funding)
        if (!payment.quote) throw 'no quote'

        expect(payment.quote.targetType).toBe(Pay.PaymentType.FixedDelivery)
        expect(payment.quote.minDeliveryAmount).toBe(BigInt(56))
        expect(payment.quote.maxSourceAmount).toBe(
          BigInt(Math.ceil(56 * 2 * (1 + config.slippage)))
        )
        expect(payment.quote.minExchangeRate.valueOf()).toBe(
          0.5 * (1 - config.slippage)
        )
        expect(payment.quote.lowExchangeRateEstimate.valueOf()).toBe(0.5)
        expect(payment.quote.highExchangeRateEstimate.valueOf()).toBe(
          0.500000000001
        )
      })

      it('QUOTING (rate service error)', async (): Promise<void> => {
        const mockFn = jest
          .spyOn(ratesService, 'prices')
          .mockImplementation(() => Promise.reject(new Error('fail')))
        const paymentId = (
          await paymentFactory.build({
            accountId,
            paymentPointer,
            amountToSend: BigInt(123)
          })
        ).id
        const payment = await processNext(paymentId, PaymentState.Quoting)

        expect(payment.stateAttempts).toBe(1)
        expect(payment.quote).toBeUndefined()

        mockFn.mockRestore()
        // Fast forward to next attempt.
        // Only mock the time once (for getPendingPayment) since otherwise ilp/pay's startQuote will get confused.
        jest
          .spyOn(Date, 'now')
          .mockReturnValueOnce(Date.now() + 1 * RETRY_BACKOFF_SECONDS * 1000)

        const payment2 = await processNext(paymentId, PaymentState.Funding)
        expect(payment2.quote?.maxSourceAmount).toBe(BigInt(123))
      })

      // This mocks QUOTING→FUNDING, but for it to trigger for real, it would go from SENDING→QUOTING(retry)→FUNDING (when the sending partially failed).
      it('FUNDING (FixedSend, 0<intent.amountToSend<amountSent)', async (): Promise<void> => {
        const payment = await paymentFactory.build({
          accountId,
          paymentPointer,
          amountToSend: BigInt(123)
        })
        jest
          .spyOn(accountingService, 'getTotalSent')
          .mockImplementation(async (id: string) => {
            expect(id).toStrictEqual(payment.id)
            return BigInt(89)
          })
        const payment2 = await processNext(payment.id, PaymentState.Funding)
        expect(payment2.quote?.maxSourceAmount).toBe(BigInt(123 - 89))
      })

      // This mocks QUOTING→COMPLETED, but for it to trigger for real, it would go from SENDING→QUOTING(retry)→COMPLETED (when the SENDING→COMPLETED transition failed to commit).
      it('COMPLETED (FixedSend, intent.amountToSend===amountSent)', async (): Promise<void> => {
        const payment = await paymentFactory.build({
          accountId,
          paymentPointer,
          amountToSend: BigInt(123)
        })
        jest
          .spyOn(accountingService, 'getTotalSent')
          .mockImplementation(async (id: string) => {
            expect(id).toStrictEqual(payment.id)
            return BigInt(123)
          })
        await processNext(payment.id, PaymentState.Completed)
      })

      // Maybe another person or payment paid the invoice already. Or it could be like the FixedSend case, where the SENDING→COMPLETED transition failed to commit, and this is a retry.
      it('COMPLETED (FixedDelivery, invoice was already full paid)', async (): Promise<void> => {
        const paymentId = (
          await paymentFactory.build({
            accountId,
            invoiceUrl
          })
        ).id
        await payInvoice(invoice.amount)
        await processNext(paymentId, PaymentState.Completed)
      })

      it('CANCELLED (FixedDelivery, intent.maxSourceAmount<quote.maxSourceAmount)', async (): Promise<void> => {
        const { id: paymentId } = await paymentFactory.build({
          accountId,
          invoiceUrl,
          maxSourceAmount: BigInt(112)
        })
        await processNext(
          paymentId,
          PaymentState.Cancelled,
          LifecycleError.QuoteTooExpensive
        )
      })

      it('CANCELLED (FixedDelivery, intent.maxSourceAmount<amountSent+quote.maxSourceAmount)', async (): Promise<void> => {
        const { id: paymentId } = await paymentFactory.build({
          accountId,
          invoiceUrl,
          maxSourceAmount: BigInt(112)
        })
        await payInvoice(invoice.amount / 2n)
        jest
          .spyOn(accountingService, 'getTotalSent')
          .mockImplementation(async (id: string) => {
            expect(id).toStrictEqual(paymentId)
            return BigInt(invoice.amount)
          })
        await processNext(
          paymentId,
          PaymentState.Cancelled,
          LifecycleError.QuoteTooExpensive
        )
      })

      it('CANCELLED (destination asset changed)', async (): Promise<void> => {
        const originalPayment = await paymentFactory.build({
          accountId,
          paymentPointer,
          amountToSend: BigInt(123)
        })
        const paymentId = originalPayment.id
        // Pretend that the destination asset was initially different.
        await OutgoingPayment.query(knex)
          .findById(paymentId)
          .patch({
            destinationAccount: Object.assign(
              {},
              originalPayment.destinationAccount,
              {
                scale: 55
              }
            )
          })

        await processNext(
          paymentId,
          PaymentState.Cancelled,
          Pay.PaymentError.DestinationAssetConflict
        )
      })
    })

    describe('FUNDING→', (): void => {
      let payment: OutgoingPayment

      beforeEach(
        async (): Promise<void> => {
          const { id: paymentId } = await paymentFactory.build({
            accountId,
            paymentPointer,
            amountToSend: BigInt(123)
          })
          payment = await processNext(paymentId, PaymentState.Funding)
          expect(payment.webhookId).not.toBeNull()
        }
      )

      it('CANCELLED (quote expired)', async (): Promise<void> => {
        // nock doesn't work with 'modern' fake timers
        // https://github.com/nock/nock/issues/2200
        // jest.useFakeTimers('modern')
        // jest.advanceTimersByTime(config.quoteLifespan + 1)

        await payment.$query(knex).patch({
          quote: Object.assign({}, payment.quote, {
            activationDeadline: new Date(Date.now() - config.quoteLifespan - 1)
          })
        })

        await processNext(
          payment.id,
          PaymentState.Cancelled,
          LifecycleError.QuoteExpired
        )
      })

      it('CANCELLED (wallet cancelled)', async (): Promise<void> => {
        const scope = mockWebhookServer(payment.id, PaymentState.Funding, 403)
        await processNext(
          payment.id,
          PaymentState.Cancelled,
          LifecycleError.CancelledByWebhook
        )
        expect(scope.isDone()).toBe(true)
      })

      it('SENDING (payment funded)', async (): Promise<void> => {
        const scope = mockWebhookServer(payment.id, PaymentState.Funding)
        await processNext(payment.id, PaymentState.Sending)
        expect(scope.isDone()).toBe(true)
        await expectOutcome(payment, {
          accountBalance: BigInt(123),
          amountSent: BigInt(0),
          amountDelivered: BigInt(0)
        })
      })

      it('FUNDING (webhook error)', async (): Promise<void> => {
        const scope = mockWebhookServer(payment.id, PaymentState.Funding, 504)
        await processNext(payment.id, PaymentState.Funding)
        expect(scope.isDone()).toBe(true)
      })

      it('FUNDING (webhook timeout)', async (): Promise<void> => {
        const scope = nock(webhookUrl.origin)
          .post(webhookUrl.pathname)
          .delayConnection(Config.webhookTimeout + 1)
          .reply(200)
        await processNext(payment.id, PaymentState.Funding)
        expect(scope.isDone()).toBe(true)
      })
    })

    describe('SENDING→', (): void => {
      beforeEach(
        async (): Promise<void> => {
          // Don't send invoice.paid webhook events
          const invoiceService = await deps.use('invoiceService')
          jest
            .spyOn(invoiceService, 'handlePayment')
            .mockImplementation(() => Promise.resolve())
        }
      )

      async function setup(opts: PaymentIntent): Promise<string> {
        const { id: paymentId } = await paymentFactory.build({
          accountId,
          ...opts
        })

        trackAmountDelivered(paymentId)

        await processNext(paymentId, PaymentState.Funding)
        const scope = mockWebhookServer(paymentId, PaymentState.Funding)
        await processNext(paymentId, PaymentState.Sending)
        expect(scope.isDone()).toBe(true)

        return paymentId
      }

      it('COMPLETED (FixedSend)', async (): Promise<void> => {
        const paymentId = await setup({
          paymentPointer,
          amountToSend: BigInt(123)
        })

        const payment = await processNext(paymentId, PaymentState.Completed)
        await expectOutcome(payment, {
          accountBalance: BigInt(0),
          amountSent: BigInt(123),
          amountDelivered: BigInt(Math.floor(123 / 2))
        })
      })

      it('COMPLETED (FixedDelivery)', async (): Promise<void> => {
        const paymentId = await setup({
          invoiceUrl,
          maxSourceAmount: BigInt(123)
        })

        const payment = await processNext(paymentId, PaymentState.Completed)
        if (!payment.quote) throw 'no quote'
        const amountSent = invoice.amount * BigInt(2)
        await expectOutcome(payment, {
          accountBalance: payment.quote.maxSourceAmount - amountSent,
          amountSent,
          amountDelivered: invoice.amount,
          invoiceReceived: invoice.amount
        })
      })

      it('COMPLETED (FixedDelivery, with invoice initially partially paid)', async (): Promise<void> => {
        const amountAlreadyDelivered = BigInt(34)
        await payInvoice(amountAlreadyDelivered)
        const paymentId = await setup({
          invoiceUrl,
          maxSourceAmount: BigInt(123)
        })

        const payment = await processNext(paymentId, PaymentState.Completed)
        if (!payment.quote) throw 'no quote'
        const amountSent = (invoice.amount - amountAlreadyDelivered) * BigInt(2)
        await expectOutcome(payment, {
          accountBalance: payment.quote.maxSourceAmount - amountSent,
          amountSent,
          amountDelivered: invoice.amount - amountAlreadyDelivered,
          invoiceReceived: invoice.amount
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
          paymentPointer,
          amountToSend: BigInt(123)
        })

        for (let i = 0; i < 4; i++) {
          const payment = await processNext(paymentId, PaymentState.Sending)
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
          PaymentState.Cancelled,
          Pay.PaymentError.ClosedByReceiver
        )
        expect(payment.stateAttempts).toBe(0)
        // "mockPay" allows a small amount of money to be paid every attempt.
        await expectOutcome(payment, {
          accountBalance: BigInt(123 - 10 * 5),
          amountSent: BigInt(10 * 5),
          amountDelivered: BigInt(5 * 5)
        })
      })

      it('CANCELLED (non-retryable Pay error)', async (): Promise<void> => {
        mockPay(
          {
            maxSourceAmount: BigInt(10),
            minDeliveryAmount: BigInt(5)
          },
          Pay.PaymentError.ReceiverProtocolViolation
        )
        const paymentId = await setup({
          paymentPointer,
          amountToSend: BigInt(123)
        })

        const payment = await processNext(
          paymentId,
          PaymentState.Cancelled,
          Pay.PaymentError.ReceiverProtocolViolation
        )
        await expectOutcome(payment, {
          accountBalance: BigInt(123 - 10),
          amountSent: BigInt(10),
          amountDelivered: BigInt(5)
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
        const amountToSend = BigInt(123)
        const paymentId = await setup({
          paymentPointer,
          amountToSend
        })

        const payment = await processNext(paymentId, PaymentState.Sending)
        mockFn.mockRestore()
        fastForwardToAttempt(1)
        await expectOutcome(payment, {
          accountBalance: BigInt(123 - 10),
          amountSent: BigInt(10),
          amountDelivered: BigInt(5)
        })

        // The next attempt is without the mock, so it succeeds.
        const payment2 = await processNext(paymentId, PaymentState.Completed)
        await expectOutcome(payment2, {
          accountBalance: BigInt(0),
          amountSent: amountToSend,
          amountDelivered: amountToSend / BigInt(2)
        })
      })

      // Caused by retry after failed SENDING→COMPLETED transition commit.
      it('COMPLETED (FixedSend, already fully paid)', async (): Promise<void> => {
        const paymentId = await setup({
          paymentPointer,
          amountToSend: BigInt(123)
        })

        await processNext(paymentId, PaymentState.Completed)
        // Pretend that the transaction didn't commit.
        await OutgoingPayment.query(knex)
          .findById(paymentId)
          .patch({ state: PaymentState.Sending })
        const payment = await processNext(paymentId, PaymentState.Completed)
        await expectOutcome(payment, {
          accountBalance: BigInt(0),
          amountSent: BigInt(123),
          amountDelivered: BigInt(123) / BigInt(2)
        })
      })

      // Caused by retry after failed SENDING→COMPLETED transition commit.
      it('COMPLETED (FixedDelivery, already fully paid)', async (): Promise<void> => {
        const paymentId = await setup({
          invoiceUrl,
          maxSourceAmount: BigInt(123)
        })
        // The quote thinks there's a full amount to pay, but actually sending will find the invoice has been paid (e.g. by another payment).
        await payInvoice(invoice.amount)

        const payment = await processNext(paymentId, PaymentState.Completed)
        if (!payment.quote) throw 'no quote'
        await expectOutcome(payment, {
          accountBalance: payment.quote.maxSourceAmount,
          amountSent: BigInt(0),
          amountDelivered: BigInt(0),
          invoiceReceived: invoice.amount
        })
      })

      it('CANCELLED (destination asset changed)', async (): Promise<void> => {
        const paymentId = await setup({
          invoiceUrl,
          maxSourceAmount: BigInt(123)
        })
        // Pretend that the destination asset was initially different.
        await OutgoingPayment.query(knex)
          .findById(paymentId)
          .patch({
            destinationAccount: {
              url: accountUrl,
              code: invoice.account.asset.code,
              scale: 55
            }
          })

        await processNext(
          paymentId,
          PaymentState.Cancelled,
          Pay.PaymentError.DestinationAssetConflict
        )
      })
    })

    describe.each`
      state                     | error
      ${PaymentState.Cancelled} | ${Pay.PaymentError.ReceiverProtocolViolation}
      ${PaymentState.Completed} | ${undefined}
    `('$state→', ({ state, error }): void => {
      let paymentId: string
      let accountBalance: bigint

      beforeEach(
        async (): Promise<void> => {
          // Don't send invoice.paid webhook events
          const invoiceService = await deps.use('invoiceService')
          jest
            .spyOn(invoiceService, 'handlePayment')
            .mockImplementation(() => Promise.resolve())

          paymentId = (
            await paymentFactory.build({
              accountId,
              invoiceUrl
            })
          ).id

          trackAmountDelivered(paymentId)

          await processNext(paymentId, PaymentState.Funding)
          const scope = mockWebhookServer(paymentId, PaymentState.Funding)
          await processNext(paymentId, PaymentState.Sending)
          expect(scope.isDone()).toBe(true)

          if (error) {
            jest.spyOn(Pay, 'pay').mockRejectedValueOnce(error)
          }
          const payment = await processNext(paymentId, state, error)
          if (!payment.quote) throw 'no quote'
          expect(payment.webhookId).not.toBeNull()

          if (state === PaymentState.Cancelled) {
            accountBalance = payment.quote?.maxSourceAmount
            await expectOutcome(payment, {
              accountBalance,
              amountSent: BigInt(0),
              amountDelivered: BigInt(0)
            })
          } else {
            const amountSent = invoice.amount * BigInt(2)
            accountBalance = payment.quote?.maxSourceAmount - amountSent
            await expectOutcome(payment, {
              accountBalance,
              amountSent,
              amountDelivered: invoice.amount
            })
          }
        }
      )

      it(`${state} (liquidity withdrawal)`, async (): Promise<void> => {
        const scope = mockWebhookServer(paymentId, state)
        const payment = await processNext(paymentId, state, error)
        expect(scope.isDone()).toBe(true)
        expect(payment.webhookId).toBeNull()
        await expect(accountingService.getBalance(paymentId)).resolves.toEqual(
          BigInt(0)
        )
        // Payment is done being processed
        await expect(
          outgoingPaymentService.processNext()
        ).resolves.toBeUndefined()
      })

      it(`${state} (webhook with empty balance)`, async (): Promise<void> => {
        jest
          .spyOn(accountingService, 'getBalance')
          .mockResolvedValueOnce(BigInt(0))
        const withdrawSpy = jest.spyOn(accountingService, 'createWithdrawal')
        const scope = mockWebhookServer(paymentId, state)
        const payment = await processNext(paymentId, state, error)
        expect(scope.isDone()).toBe(true)
        expect(withdrawSpy).not.toHaveBeenCalled()
        expect(payment.webhookId).toBeNull()

        // Payment is done being processed
        await expect(
          outgoingPaymentService.processNext()
        ).resolves.toBeUndefined()
      })

      it(`${state} (webhook error)`, async (): Promise<void> => {
        const scope = mockWebhookServer(paymentId, state, 504)
        const payment = await processNext(paymentId, state, error)
        expect(scope.isDone()).toBe(true)
        expect(payment.webhookId).not.toBeNull()
        await expect(accountingService.getBalance(paymentId)).resolves.toEqual(
          accountBalance
        )
      })

      it(`${state} (webhook timeout)`, async (): Promise<void> => {
        const scope = nock(webhookUrl.origin)
          .post(webhookUrl.pathname)
          .delayConnection(Config.webhookTimeout + 1)
          .reply(200)
        const payment = await processNext(paymentId, state, error)
        expect(scope.isDone()).toBe(true)
        expect(payment.webhookId).not.toBeNull()
        await expect(accountingService.getBalance(paymentId)).resolves.toEqual(
          accountBalance
        )
      })

      if (state === PaymentState.Cancelled) {
        it('QUOTING (withdraw + requote)', async (): Promise<void> => {
          const scope = mockWebhookServer(paymentId, state, 205)
          await processNext(paymentId, PaymentState.Quoting)
          expect(scope.isDone()).toBe(true)
          await expect(
            accountingService.getBalance(paymentId)
          ).resolves.toEqual(BigInt(0))
        })
      }
    })
  })

  describe('getAccountPage', () => {
    let paymentsCreated: OutgoingPayment[]

    beforeEach(async (): Promise<void> => {
      paymentsCreated = []
      for (let i = 0; i < 40; i++) {
        paymentsCreated.push(
          await paymentFactory.build({
            accountId,
            paymentPointer,
            amountToSend: BigInt(123)
          })
        )
      }
    }, 10_000)

    afterEach(
      async (): Promise<void> => {
        await truncateTable(knex, 'outgoingPayments')
      }
    )

    test('Defaults to fetching first 20 items', async (): Promise<void> => {
      const payments = await outgoingPaymentService.getAccountPage(accountId)
      expect(payments).toHaveLength(20)
      expect(payments[0].id).toEqual(paymentsCreated[0].id)
      expect(payments[19].id).toEqual(paymentsCreated[19].id)
      expect(payments[20]).toBeUndefined()
    })

    test('Can change forward pagination limit', async (): Promise<void> => {
      const pagination = {
        first: 10
      }
      const payments = await outgoingPaymentService.getAccountPage(
        accountId,
        pagination
      )
      expect(payments).toHaveLength(10)
      expect(payments[0].id).toEqual(paymentsCreated[0].id)
      expect(payments[9].id).toEqual(paymentsCreated[9].id)
      expect(payments[10]).toBeUndefined()
    })

    test('Can paginate forwards from a cursor', async (): Promise<void> => {
      const pagination = {
        after: paymentsCreated[19].id
      }
      const payments = await outgoingPaymentService.getAccountPage(
        accountId,
        pagination
      )
      expect(payments).toHaveLength(20)
      expect(payments[0].id).toEqual(paymentsCreated[20].id)
      expect(payments[19].id).toEqual(paymentsCreated[39].id)
      expect(payments[20]).toBeUndefined()
    })

    test('Can paginate forwards from a cursor with a limit', async (): Promise<void> => {
      const pagination = {
        first: 10,
        after: paymentsCreated[9].id
      }
      const payments = await outgoingPaymentService.getAccountPage(
        accountId,
        pagination
      )
      expect(payments).toHaveLength(10)
      expect(payments[0].id).toEqual(paymentsCreated[10].id)
      expect(payments[9].id).toEqual(paymentsCreated[19].id)
      expect(payments[10]).toBeUndefined()
    })

    test("Can't change backward pagination limit on it's own.", async (): Promise<void> => {
      const pagination = {
        last: 10
      }
      const payments = outgoingPaymentService.getAccountPage(
        accountId,
        pagination
      )
      await expect(payments).rejects.toThrow(
        "Can't paginate backwards from the start."
      )
    })

    test('Can paginate backwards from a cursor', async (): Promise<void> => {
      const pagination = {
        before: paymentsCreated[20].id
      }
      const payments = await outgoingPaymentService.getAccountPage(
        accountId,
        pagination
      )
      expect(payments).toHaveLength(20)
      expect(payments[0].id).toEqual(paymentsCreated[0].id)
      expect(payments[19].id).toEqual(paymentsCreated[19].id)
      expect(payments[20]).toBeUndefined()
    })

    test('Can paginate backwards from a cursor with a limit', async (): Promise<void> => {
      const pagination = {
        last: 5,
        before: paymentsCreated[10].id
      }
      const payments = await outgoingPaymentService.getAccountPage(
        accountId,
        pagination
      )
      expect(payments).toHaveLength(5)
      expect(payments[0].id).toEqual(paymentsCreated[5].id)
      expect(payments[4].id).toEqual(paymentsCreated[9].id)
      expect(payments[5]).toBeUndefined()
    })

    test('Backwards/Forwards pagination results in same order.', async (): Promise<void> => {
      const paginationForwards = {
        first: 10
      }
      const paymentsForwards = await outgoingPaymentService.getAccountPage(
        accountId,
        paginationForwards
      )
      const paginationBackwards = {
        last: 10,
        before: paymentsCreated[10].id
      }
      const paymentsBackwards = await outgoingPaymentService.getAccountPage(
        accountId,
        paginationBackwards
      )
      expect(paymentsForwards).toHaveLength(10)
      expect(paymentsBackwards).toHaveLength(10)
      expect(paymentsForwards).toEqual(paymentsBackwards)
    })

    test('Providing before and after results in forward pagination', async (): Promise<void> => {
      const pagination = {
        after: paymentsCreated[19].id,
        before: paymentsCreated[19].id
      }
      const payments = await outgoingPaymentService.getAccountPage(
        accountId,
        pagination
      )
      expect(payments).toHaveLength(20)
      expect(payments[0].id).toEqual(paymentsCreated[20].id)
      expect(payments[19].id).toEqual(paymentsCreated[39].id)
      expect(payments[20]).toBeUndefined()
    })

    test("Can't request less than 0 payments", async (): Promise<void> => {
      const pagination = {
        first: -1
      }
      const payments = outgoingPaymentService.getAccountPage(
        accountId,
        pagination
      )
      await expect(payments).rejects.toThrow('Pagination index error')
    })

    test("Can't request more than 100 payments", async (): Promise<void> => {
      const pagination = {
        first: 101
      }
      const payments = outgoingPaymentService.getAccountPage(
        accountId,
        pagination
      )
      await expect(payments).rejects.toThrow('Pagination index error')
    })
  })
})
