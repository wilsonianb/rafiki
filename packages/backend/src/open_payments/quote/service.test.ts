import assert from 'assert'
import axios from 'axios'
import nock, { Definition } from 'nock'
import Knex from 'knex'
import * as Pay from '@interledger/pay'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'

import { QuoteError, isQuoteError } from './errors'
import {
  QuoteService,
  CreateQuoteOptions,
  generateQuoteSignature
} from './service'
import { createTestApp, TestContainer } from '../../tests/app'
import { IAppConfig, Config } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { truncateTables } from '../../tests/tableManager'
import { AccountingService } from '../../accounting/service'
import { AssetOptions } from '../../asset/service'
import { Amount } from '../payment/amount'
import { IncomingPayment } from '../payment/incoming/model'
// import { RatesService } from '../../rates/service'
// import { Pagination } from '../../shared/baseModel'
// import { getPageTests } from '../../shared/baseModel.test'
import { isIncomingPaymentError } from '../payment/incoming/errors'

describe('QuoteService', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let quoteService: QuoteService
  // let ratesService: RatesService
  let accountingService: AccountingService
  let knex: Knex
  let accountId: string
  let incomingPayment: IncomingPayment
  let receivingPayment: string
  let accountUrl: string
  let receivingAccount: string
  let config: IAppConfig
  let quoteUrl: URL
  const SIGNATURE_SECRET = 'test secret'

  const asset: AssetOptions = {
    scale: 9,
    code: 'USD'
  }

  const sendAmount = {
    value: BigInt(123),
    assetCode: asset.code,
    assetScale: asset.scale
  }

  const destinationAsset = {
    scale: 9,
    code: 'XRP'
  }

  const receiveAmount = {
    value: BigInt(56),
    assetCode: destinationAsset.code,
    assetScale: destinationAsset.scale
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
        return axios
          .post(`http://localhost:${appContainer.port}${path}`, requestBody, {
            headers: this.req.headers
          })
          .then((res) => {
            receivingPayment = res.data.id
            return res.data
          })
      })
  }

  // async function createQuote(
  //   options: CreateQuoteOptions
  // ): Promise<Quote> {
  //   const quote = await quoteService.create(options)
  //   assert.ok(!isQuoteError(quote))
  //   return quote
  // }

  // async function processNext(
  //   quoteId: string,
  //   expectState: QuoteState,
  //   expectedError?: string
  // ): Promise<Quote> {
  //   await expect(quoteService.processNext()).resolves.toBe(quoteId)
  //   const quote = await quoteService.get(quoteId)
  //   if (!quote) throw 'no quote'
  //   if (expectState) expect(quote.state).toBe(expectState)
  //   // expect(quote.error).toEqual(expectedError || null)
  //   // const type = webhookTypes[quote.state]
  //   // if (type) {
  //   //   await expect(
  //   //     PaymentEvent.query(knex).where({
  //   //       type
  //   //     })
  //   //   ).resolves.not.toHaveLength(0)
  //   // }
  //   return quote
  // }

  // Mock the time to fast-forward to the time that the specified (absolute, not relative) attempt is scheduled.
  // function fastForwardToAttempt(stateAttempts: number): void {
  //   jest
  //     .spyOn(Date, 'now')
  //     .mockReturnValue(
  //       Date.now() + stateAttempts * RETRY_BACKOFF_SECONDS * 1000
  //     )
  // }

  // async function payIncomingPayment(amount: bigint): Promise<void> {
  //   await expect(
  //     accountingService.createDeposit({
  //       id: uuid(),
  //       account: incomingPayment,
  //       amount
  //     })
  //   ).resolves.toBeUndefined()
  // }

  beforeAll(
    async (): Promise<void> => {
      Config.pricesUrl = 'https://test.prices'
      Config.signatureSecret = SIGNATURE_SECRET
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
      // ratesService = await deps.use('ratesService')

      knex = await deps.use('knex')
      config = await deps.use('config')
      quoteUrl = new URL(Config.quoteUrl)
    }
  )

  beforeEach(
    async (): Promise<void> => {
      quoteService = await deps.use('quoteService')
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
    it('returns undefined when no quote exists', async () => {
      await expect(quoteService.get(uuid())).resolves.toBeUndefined()
    })
  })

  describe('create', (): void => {
    function mockWalletQuote(
      {
        sendAmount,
        receiveAmount,
        status
      }: {
        sendAmount?: Amount
        receiveAmount?: Amount
        status?: number
      } = { status: 201 }
    ): nock.Scope {
      return (
        nock(quoteUrl.origin)
          // .matchHeader('Accept', 'application/json')
          // .matchHeader('Content-Type', 'application/json')
          .post(quoteUrl.pathname, function (this: Definition, body) {
            assert.ok(this.headers)
            const signature = this.headers['rafiki-signature']
            expect(
              generateQuoteSignature(
                body,
                SIGNATURE_SECRET,
                Config.signatureVersion
              )
            ).toEqual(signature)
            // expect(body).toMatchObject({
            //   id: event.id,
            //   type: event.type,
            //   data: event.data
            // })
            return true
          })
          .reply(
            status,
            function (_path: string, requestBody: Record<string, unknown>) {
              if (sendAmount) {
                requestBody.sendAmount = {
                  ...sendAmount,
                  value: sendAmount.value.toString()
                }
              }
              if (receiveAmount) {
                requestBody.receiveAmount = {
                  ...receiveAmount,
                  value: receiveAmount.value.toString()
                }
              }
              return requestBody
            }
          )
      )
    }

    test.each`
      toAccount | description
      ${true}   | ${'account'}
      ${false}  | ${'incoming payment'}
    `(
      'creates a Quote with sendAmount to $description (sendAmount)',
      async ({ toAccount }): Promise<void> => {
        const options: CreateQuoteOptions = {
          accountId,
          sendAmount
        }
        let paymentScope: nock.Scope | undefined
        if (toAccount) {
          options.receivingAccount = receivingAccount
          paymentScope = mockCreateIncomingPayment()
        } else {
          options.receivingPayment = receivingPayment
        }
        const walletScope = mockWalletQuote()
        const quote = await quoteService.create(options)
        if (toAccount) {
          assert.ok(paymentScope)
          paymentScope.isDone()
        }
        walletScope.isDone()
        assert.ok(!isQuoteError(quote))
        expect(quote).toMatchObject({
          accountId,
          receivingPayment,
          paymentType: Pay.PaymentType.FixedDelivery,
          sendAmount,
          receiveAmount: {
            value: BigInt(Math.ceil(123 * quote.minExchangeRate.valueOf())),
            assetCode: destinationAsset.code,
            assetScale: destinationAsset.scale
          },
          maxPacketAmount: BigInt('9223372036854775807')
        })
        expect(quote.minExchangeRate.valueOf()).toBe(
          0.5 * (1 - config.slippage)
        )
        expect(quote.lowEstimatedExchangeRate.valueOf()).toBe(0.5)
        expect(quote.highEstimatedExchangeRate.valueOf()).toBe(0.500000000001)

        await expect(quoteService.get(quote.id)).resolves.toEqual(quote)
      }
    )

    test.each`
      toAccount | description
      ${true}   | ${'account'}
      ${false}  | ${'incoming payment'}
    `(
      'creates a Quote with receiveAmount to $description (receiveAmount)',
      async ({ toAccount }): Promise<void> => {
        const options: CreateQuoteOptions = {
          accountId,
          receiveAmount
        }
        let paymentScope: nock.Scope | undefined
        if (toAccount) {
          options.receivingAccount = receivingAccount
          paymentScope = mockCreateIncomingPayment(receiveAmount)
        } else {
          options.receivingPayment = receivingPayment
        }
        const walletScope = mockWalletQuote()
        const quote = await quoteService.create(options)
        if (toAccount) {
          assert.ok(paymentScope)
          paymentScope.isDone()
        }
        walletScope.isDone()
        assert.ok(!isQuoteError(quote))
        expect(quote).toMatchObject({
          accountId,
          receivingPayment,
          paymentType: Pay.PaymentType.FixedDelivery,
          sendAmount: {
            value: BigInt(
              Math.ceil(Number(receiveAmount.value) * 2 * (1 + config.slippage))
            ),
            assetCode: asset.code,
            assetScale: asset.scale
          },
          receiveAmount,
          maxPacketAmount: BigInt('9223372036854775807')
        })
        expect(quote.minExchangeRate.valueOf()).toBe(
          0.5 * (1 - config.slippage)
        )
        expect(quote.lowEstimatedExchangeRate.valueOf()).toBe(0.5)
        expect(quote.highEstimatedExchangeRate.valueOf()).toBe(0.500000000001)
        await expect(quoteService.get(quote.id)).resolves.toEqual(quote)
      }
    )

    it('creates a Quote to incoming payment', async () => {
      const options = {
        accountId,
        receivingPayment
      }
      const scope = mockWalletQuote()
      const quote = await quoteService.create(options)
      scope.isDone()
      assert.ok(!isQuoteError(quote))
      expect(quote).toMatchObject({
        ...options,
        paymentType: Pay.PaymentType.FixedDelivery,
        maxPacketAmount: BigInt('9223372036854775807'),
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
        receiveAmount: {
          ...incomingPayment.incomingAmount
        }
      })
      expect(quote.minExchangeRate.valueOf()).toBe(0.5 * (1 - config.slippage))
      expect(quote.lowEstimatedExchangeRate.valueOf()).toBe(0.5)
      expect(quote.highEstimatedExchangeRate.valueOf()).toBe(0.500000000001)
      await expect(quoteService.get(quote.id)).resolves.toEqual(quote)
    })

    // fail if incoming payment has no incoming amount

    // fail if receiveAmount exceed incoming amount (fixed send or fixed receive)

    // receivingPayment and receivingAccount are defined in `beforeEach`
    // and unavailable in the `test.each` table
    test.each`
      toPayment | toAccount | sendAmount                              | receiveAmount                              | error                            | description
      ${false}  | ${false}  | ${sendAmount}                           | ${undefined}                               | ${QuoteError.InvalidDestination} | ${'without a destination'}
      ${true}   | ${true}   | ${sendAmount}                           | ${undefined}                               | ${QuoteError.InvalidDestination} | ${'with multiple destinations'}
      ${false}  | ${true}   | ${undefined}                            | ${undefined}                               | ${QuoteError.InvalidAmount}      | ${'with missing amount'}
      ${true}   | ${false}  | ${sendAmount}                           | ${receiveAmount}                           | ${QuoteError.InvalidAmount}      | ${'with multiple amounts'}
      ${false}  | ${true}   | ${{ ...sendAmount, value: BigInt(0) }}  | ${undefined}                               | ${QuoteError.InvalidAmount}      | ${'sendAmount of zero'}
      ${false}  | ${true}   | ${{ ...sendAmount, value: BigInt(-1) }} | ${undefined}                               | ${QuoteError.InvalidAmount}      | ${'negative sendAmount'}
      ${false}  | ${true}   | ${undefined}                            | ${{ ...receiveAmount, value: BigInt(0) }}  | ${QuoteError.InvalidAmount}      | ${'receiveAmount of zero'}
      ${false}  | ${true}   | ${undefined}                            | ${{ ...receiveAmount, value: BigInt(-1) }} | ${QuoteError.InvalidAmount}      | ${'negative receiveAmount'}
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
          quoteService.create({
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
})
