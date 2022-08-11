import assert from 'assert'
import nock from 'nock'
import Knex from 'knex'
import * as Pay from '@interledger/pay'
import { v4 as uuid } from 'uuid'

import {
  FundingError,
  LifecycleError,
  OutgoingPaymentError,
  isOutgoingPaymentError
} from './errors'
import { OutgoingPaymentService } from './service'
import { createTestApp, TestContainer } from '../../../tests/app'
import { IAppConfig, Config } from '../../../config/app'
import { createIncomingPayment } from '../../../tests/incomingPayment'
import { createOutgoingPayment } from '../../../tests/outgoingPayment'
import { PeerFactory } from '../../../tests/peerFactory'
import { createQuote } from '../../../tests/quote'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../../'
import { AppServices } from '../../../app'
import { truncateTables } from '../../../tests/tableManager'
import {
  OutgoingPayment,
  OutgoingPaymentState,
  OutgoingPaymentData,
  OutgoingPaymentEvent,
  OutgoingPaymentEventType
} from './model'
import { RETRY_BACKOFF_SECONDS } from './worker'
import { isTransferError } from '../../../accounting/errors'
import { AccountingService, TransferOptions } from '../../../accounting/service'
import { AssetOptions } from '../../../asset/service'
import { CreateQuoteOptions } from '../../quote/service'
import { Pagination } from '../../../shared/baseModel'
import { getPageTests } from '../../../shared/baseModel.test'
import { Amount } from '../../amount'

describe('OutgoingPaymentService', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let outgoingPaymentService: OutgoingPaymentService
  let accountingService: AccountingService
  let knex: Knex
  let accountId: string
  let receivingAccount: string
  let receiver: string
  let receiverAccountId: string
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

  const webhookTypes: {
    [key in OutgoingPaymentState]: OutgoingPaymentEventType | undefined
  } = {
    [OutgoingPaymentState.Funding]:
      OutgoingPaymentEventType.OutgoingPaymentCreated,
    [OutgoingPaymentState.Sending]: undefined,
    [OutgoingPaymentState.Failed]:
      OutgoingPaymentEventType.OutgoingPaymentFailed,
    [OutgoingPaymentState.Completed]:
      OutgoingPaymentEventType.OutgoingPaymentCompleted
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
        OutgoingPaymentEvent.query(knex).where({
          type
        })
      ).resolves.not.toHaveLength(0)
    }
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

  function getIncomingPaymentId(receiver: string): string {
    return receiver.slice(`${receivingAccount}/incoming-payments/`.length)
  }

  async function payIncomingPayment({
    receiver,
    amount
  }: {
    receiver: string
    amount: bigint
  }): Promise<void> {
    const incomingPaymentService = await deps.use('incomingPaymentService')
    const incomingPayment = await incomingPaymentService.get(
      getIncomingPaymentId(receiver)
    )
    assert.ok(incomingPayment)
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
      expect(payment.sentAmount.value).toEqual(amountSent)
    }
    await expect(accountingService.getTotalSent(payment.id)).resolves.toBe(
      payment.sentAmount.value
    )
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
        accountingService.getTotalReceived(
          getIncomingPaymentId(payment.receiver)
        )
      ).resolves.toEqual(incomingPaymentReceived)
    }
    if (withdrawAmount !== undefined) {
      await expect(
        OutgoingPaymentEvent.query(knex).where({
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
      receiverAccountId = destinationAccount.id
      await expect(
        accountingService.createDeposit({
          id: uuid(),
          account: destinationAccount.asset,
          amount: BigInt(123)
        })
      ).resolves.toBeUndefined()
      receivingAccount = `${config.publicHost}/${destinationAccount.id}`
      const incomingPayment = await createIncomingPayment(deps, {
        accountId: receiverAccountId
      })
      receiver = `${receivingAccount}/incoming-payments/${incomingPayment.id}`

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

    it('throws if no TB account found', async (): Promise<void> => {
      const quote = await createQuote(deps, {
        accountId,
        receiver,
        sendAmount
      })
      const options = {
        accountId,
        quoteId: quote.id,
        description: 'rent',
        externalRef: '202201'
      }
      const payment = await outgoingPaymentService.create(options)
      assert.ok(!isOutgoingPaymentError(payment))

      jest
        .spyOn(accountingService, 'getTotalSent')
        .mockResolvedValueOnce(undefined)
      await expect(outgoingPaymentService.get(payment.id)).rejects.toThrowError(
        `Underlying TB account not found, payment id: ${payment.id}`
      )
    })
  })

  describe('create', (): void => {
    it.each`
      outgoingPeer | description
      ${false}     | ${''}
      ${true}      | ${'with an outgoing peer'}
    `(
      'creates an OutgoingPayment from a quote $description',
      async ({ outgoingPeer }): Promise<void> => {
        const peerService = await deps.use('peerService')
        const peerFactory = new PeerFactory(peerService)
        const peer = await peerFactory.build()
        const quote = await createQuote(deps, {
          accountId,
          receiver,
          sendAmount
        })
        const options = {
          accountId,
          quoteId: quote.id,
          description: 'rent',
          externalRef: '202201'
        }
        if (outgoingPeer) {
          jest
            .spyOn(peerService, 'getByDestinationAddress')
            .mockResolvedValueOnce(peer)
        }
        const payment = await outgoingPaymentService.create(options)
        assert.ok(!isOutgoingPaymentError(payment))
        expect(payment).toMatchObject({
          id: quote.id,
          accountId,
          receiver: quote.receiver,
          sendAmount: quote.sendAmount,
          receiveAmount: quote.receiveAmount,
          description: options.description,
          externalRef: options.externalRef,
          state: OutgoingPaymentState.Funding,
          asset,
          quote,
          peerId: outgoingPeer ? peer.id : null
        })
        await expectOutcome(payment, { accountBalance: BigInt(0) })

        await expect(outgoingPaymentService.get(payment.id)).resolves.toEqual(
          payment
        )

        const expectedPaymentData: Partial<
          OutgoingPaymentData['outgoingPayment']
        > = {
          id: payment.id
        }
        if (outgoingPeer) {
          expectedPaymentData.peerId = peer.id
        }
        await expect(
          OutgoingPaymentEvent.query(knex).where({
            type: OutgoingPaymentEventType.OutgoingPaymentCreated
          })
        ).resolves.toMatchObject([
          {
            data: {
              outgoingPayment: expectedPaymentData
            }
          }
        ])
      }
    )

    it('fails to create on unknown account', async () => {
      const { id: quoteId } = await createQuote(deps, {
        accountId,
        receiver,
        sendAmount,
        validDestination: false
      })
      await expect(
        outgoingPaymentService.create({
          accountId: uuid(),
          quoteId
        })
      ).resolves.toEqual(OutgoingPaymentError.UnknownAccount)
    })

    it('fails to create on unknown quote', async () => {
      await expect(
        outgoingPaymentService.create({
          accountId,
          quoteId: uuid()
        })
      ).resolves.toEqual(OutgoingPaymentError.UnknownQuote)
    })

    it('fails to create on invalid quote account', async () => {
      const quote = await createQuote(deps, {
        accountId,
        receiver,
        sendAmount,
        validDestination: false
      })
      await expect(
        outgoingPaymentService.create({
          accountId: receiverAccountId,
          quoteId: quote.id
        })
      ).resolves.toEqual(OutgoingPaymentError.InvalidQuote)
    })

    it('fails to create on expired quote', async () => {
      const quote = await createQuote(deps, {
        accountId,
        receiver,
        sendAmount,
        validDestination: false
      })
      await quote.$query(knex).patch({
        expiresAt: new Date()
      })
      await expect(
        outgoingPaymentService.create({
          accountId,
          quoteId: quote.id
        })
      ).resolves.toEqual(OutgoingPaymentError.InvalidQuote)
    })
  })

  describe('processNext', (): void => {
    describe('SENDING→', (): void => {
      const receiveAmount = {
        value: BigInt(123),
        assetCode: destinationAsset.code,
        assetScale: destinationAsset.scale
      }

      async function setup(
        opts: Omit<CreateQuoteOptions, 'accountId'>,
        incomingAmount?: Amount
      ): Promise<string> {
        if (incomingAmount) {
          const incomingPaymentService = await deps.use(
            'incomingPaymentService'
          )
          const incomingPayment = await incomingPaymentService.get(
            getIncomingPaymentId(receiver)
          )
          assert.ok(incomingPayment)
          await incomingPayment.$query(knex).patch({ incomingAmount })
        }
        const payment = await createOutgoingPayment(deps, {
          accountId,
          ...opts
        })

        trackAmountDelivered(payment.id)

        await expect(
          outgoingPaymentService.fund({
            id: payment.id,
            amount: payment.sendAmount.value,
            transferId: uuid()
          })
        ).resolves.toMatchObject({
          state: OutgoingPaymentState.Sending
        })

        return payment.id
      }

      test.each`
        sendAmount    | receiveAmount
        ${sendAmount} | ${undefined}
        ${undefined}  | ${receiveAmount}
      `(
        'COMPLETED',
        async ({ sendAmount, receiveAmount }): Promise<void> => {
          const paymentId = await setup({
            receiver,
            sendAmount,
            receiveAmount
          })

          let scope: nock.Scope | undefined
          const payment = await processNext(
            paymentId,
            OutgoingPaymentState.Completed
          )
          scope?.isDone()
          if (!payment.sendAmount) throw 'no sendAmount'
          const amountSent = payment.receiveAmount.value * BigInt(2)
          await expectOutcome(payment, {
            accountBalance: payment.sendAmount.value - amountSent,
            amountSent,
            amountDelivered: payment.receiveAmount.value,
            incomingPaymentReceived: payment.receiveAmount.value,
            withdrawAmount: payment.sendAmount.value - amountSent
          })
        }
      )

      it('COMPLETED (with incoming payment initially partially paid)', async (): Promise<void> => {
        const paymentId = await setup(
          {
            receiver
          },
          receiveAmount
        )

        const amountAlreadyDelivered = BigInt(34)
        await payIncomingPayment({
          receiver,
          amount: amountAlreadyDelivered
        })

        const payment = await processNext(
          paymentId,
          OutgoingPaymentState.Completed
        )
        if (!payment.sendAmount) throw 'no sendAmount'
        const amountSent =
          (payment.receiveAmount.value - amountAlreadyDelivered) * BigInt(2)
        await expectOutcome(payment, {
          accountBalance: payment.sendAmount.value - amountSent,
          amountSent,
          amountDelivered: payment.receiveAmount.value - amountAlreadyDelivered,
          incomingPaymentReceived: payment.receiveAmount.value,
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
          receiver,
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
          receiver,
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
          receiver,
          receiveAmount
        })

        const payment = await processNext(
          paymentId,
          OutgoingPaymentState.Sending
        )
        mockFn.mockRestore()
        fastForwardToAttempt(1)
        await expectOutcome(payment, {
          accountBalance: payment.sendAmount.value - BigInt(10),
          amountSent: BigInt(10),
          amountDelivered: BigInt(5)
        })

        // The next attempt is without the mock, so it succeeds.
        const payment2 = await processNext(
          paymentId,
          OutgoingPaymentState.Completed
        )
        const sentAmount = payment.receiveAmount.value * BigInt(2)
        await expectOutcome(payment2, {
          accountBalance: payment.sendAmount.value - sentAmount,
          amountSent: sentAmount,
          amountDelivered: payment.receiveAmount.value
        })
      })

      // Caused by retry after failed SENDING→COMPLETED transition commit.
      it('COMPLETED (FixedSend, already fully paid)', async (): Promise<void> => {
        const paymentId = await setup(
          {
            receiver,
            receiveAmount
          },
          receiveAmount
        )

        await processNext(paymentId, OutgoingPaymentState.Completed)
        // Pretend that the transaction didn't commit.
        await OutgoingPayment.query(knex)
          .findById(paymentId)
          .patch({ state: OutgoingPaymentState.Sending })
        const payment = await processNext(
          paymentId,
          OutgoingPaymentState.Completed
        )
        const sentAmount = payment.receiveAmount.value * BigInt(2)
        await expectOutcome(payment, {
          accountBalance: payment.sendAmount.value - sentAmount,
          amountSent: sentAmount,
          amountDelivered: payment.receiveAmount.value
        })
      })

      // Caused by retry after failed SENDING→COMPLETED transition commit.
      it('COMPLETED (already fully paid)', async (): Promise<void> => {
        const paymentId = await setup(
          {
            receiver,
            receiveAmount
          },
          receiveAmount
        )
        // The quote thinks there's a full amount to pay, but actually sending will find the incoming payment has been paid (e.g. by another payment).
        await payIncomingPayment({
          receiver,
          amount: receiveAmount.value
        })

        const payment = await processNext(
          paymentId,
          OutgoingPaymentState.Completed
        )
        if (!payment.sendAmount) throw 'no sendAmount'
        await expectOutcome(payment, {
          accountBalance: payment.sendAmount.value,
          amountSent: BigInt(0),
          amountDelivered: BigInt(0),
          incomingPaymentReceived: receiveAmount.value,
          withdrawAmount: payment.sendAmount.value
        })
      })

      it('FAILED (source asset changed)', async (): Promise<void> => {
        const paymentId = await setup({
          receiver,
          sendAmount
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
          receiver,
          sendAmount
        })
        // Pretend that the destination asset was initially different.
        await OutgoingPayment.relatedQuery('quote')
          .for(paymentId)
          .patch({
            receiveAmount: {
              ...receiveAmount,
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
      payment = await createOutgoingPayment(deps, {
        accountId,
        receiver,
        sendAmount,
        validDestination: false
      })
      quoteAmount = payment.sendAmount.value
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
        createOutgoingPayment(deps, {
          accountId,
          receiver,
          sendAmount,
          validDestination: false
        }),
      getPage: (pagination: Pagination) =>
        outgoingPaymentService.getAccountPage(accountId, pagination)
    })

    it('throws if no TB account found', async (): Promise<void> => {
      const payment = await createOutgoingPayment(deps, {
        accountId,
        receiver,
        sendAmount,
        validDestination: false
      })

      jest
        .spyOn(accountingService, 'getAccountsTotalSent')
        .mockResolvedValueOnce([undefined])
      await expect(
        outgoingPaymentService.getAccountPage(accountId, {})
      ).rejects.toThrowError(
        `Underlying TB account not found, payment id: ${payment.id}`
      )
    })
  })
})
