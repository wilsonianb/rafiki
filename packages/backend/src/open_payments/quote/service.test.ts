import assert from 'assert'
import nock, { Definition } from 'nock'
import { Knex } from 'knex'
import * as Pay from '@interledger/pay'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'

import { QuoteError, isQuoteError } from './errors'
import { Quote } from './model'
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
import { createIncomingPayment } from '../../tests/incomingPayment'
import {
  createPaymentPointer,
  MockPaymentPointer
} from '../../tests/paymentPointer'
import { createQuote } from '../../tests/quote'
import { truncateTables } from '../../tests/tableManager'
import { AssetOptions } from '../../asset/service'
import { Amount, AmountJSON, serializeAmount } from '../amount'
import {
  IncomingPayment,
  IncomingPaymentState
} from '../payment/incoming/model'
import { Pagination } from '../../shared/baseModel'
import { getPageTests } from '../../shared/baseModel.test'
import { GrantReference } from '../grantReference/model'
import { GrantReferenceService } from '../grantReference/service'

describe('QuoteService', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let quoteService: QuoteService
  let knex: Knex
  let paymentPointerId: string
  let assetId: string
  let receivingPaymentPointer: MockPaymentPointer
  let config: IAppConfig
  let quoteUrl: URL
  let grantReferenceService: GrantReferenceService
  let grantRef: GrantReference
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

  beforeAll(async (): Promise<void> => {
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

    knex = await deps.use('knex')
    config = await deps.use('config')
    quoteUrl = new URL(Config.quoteUrl)
    grantReferenceService = await deps.use('grantReferenceService')
  })

  beforeEach(async (): Promise<void> => {
    quoteService = await deps.use('quoteService')
    const paymentPointer = await createPaymentPointer(deps, {
      asset: {
        code: sendAmount.assetCode,
        scale: sendAmount.assetScale
      }
    })
    paymentPointerId = paymentPointer.id
    assetId = paymentPointer.assetId
    receivingPaymentPointer = await createPaymentPointer(deps, {
      asset: destinationAsset,
      mockServerPort: appContainer.openPaymentsPort
    })
    grantRef = await grantReferenceService.create({
      id: uuid(),
      clientId: appContainer.clientId
    })
    const accountingService = await deps.use('accountingService')
    await expect(
      accountingService.createDeposit({
        id: uuid(),
        account: receivingPaymentPointer.asset,
        amount: BigInt(123)
      })
    ).resolves.toBeUndefined()
  })

  afterEach(async (): Promise<void> => {
    jest.restoreAllMocks()
    receivingPaymentPointer.scope?.persist(false)
    await truncateTables(knex)
  })

  afterAll(async (): Promise<void> => {
    await appContainer.shutdown()
  })

  enum GetOption {
    Matching = 'matching',
    Conflicting = 'conflicting',
    Unspecified = 'unspecified'
  }

  describe('get', (): void => {
    let quote: Quote

    beforeEach(async (): Promise<void> => {
      quote = await createQuote(deps, {
        paymentPointerId,
        receiver: `${receivingPaymentPointer.url}/incoming-payments/${uuid()}`,
        sendAmount: {
          value: BigInt(56),
          assetCode: asset.code,
          assetScale: asset.scale
        },
        validDestination: false
      })
    })
    describe.each`
      match    | description
      ${true}  | ${GetOption.Matching}
      ${false} | ${GetOption.Conflicting}
    `('$description id', ({ match, description }): void => {
      let id: string
      beforeEach((): void => {
        id = description === GetOption.Matching ? quote.id : uuid()
      })
      describe.each`
        match    | description
        ${match} | ${GetOption.Matching}
        ${false} | ${GetOption.Conflicting}
        ${match} | ${GetOption.Unspecified}
      `('$description paymentPointerId', ({ match, description }): void => {
        let paymentPointerId: string
        beforeEach((): void => {
          switch (description) {
            case GetOption.Matching:
              paymentPointerId = quote.paymentPointerId
              break
            case GetOption.Conflicting:
              paymentPointerId = uuid()
              break
            case GetOption.Unspecified:
              paymentPointerId = undefined
              break
          }
        })
        test(`${
          match ? '' : 'cannot '
        }get a quote`, async (): Promise<void> => {
          await expect(
            quoteService.get({
              id,
              paymentPointerId
            })
          ).resolves.toEqual(match ? quote : undefined)
        })
      })
    })
  })

  interface ExpectedQuote {
    receiver?: string
    sendAmount?: Amount
    receiveAmount?: Amount
    paymentType: Pay.PaymentType
  }

  describe('create', (): void => {
    function mockWalletQuote({
      expected,
      sendAmount,
      receiveAmount,
      status = 201
    }: {
      expected: ExpectedQuote
      sendAmount?: AmountJSON
      receiveAmount?: AmountJSON
      status?: number
    }): nock.Scope {
      return nock(quoteUrl.origin)
        .matchHeader('Accept', 'application/json')
        .matchHeader('Content-Type', 'application/json')
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
          try {
            expect(body).toEqual({
              id: expect.any(String),
              paymentPointerId,
              receiver: expected.receiver || expect.any(String),
              sendAmount: {
                value:
                  expected.sendAmount?.value.toString() || expect.any(String),
                assetCode: asset.code,
                assetScale: asset.scale
              },
              receiveAmount: {
                value:
                  expected.receiveAmount?.value.toString() ||
                  expect.any(String),
                assetCode: destinationAsset.code,
                assetScale: destinationAsset.scale
              },
              paymentType: expected.paymentType,
              createdAt: expect.any(String),
              expiresAt: expect.any(String)
            })
          } catch (err) {
            return false
          }
          return true
        })
        .reply(
          status,
          function (_path: string, requestBody: Record<string, unknown>) {
            if (sendAmount) {
              requestBody.sendAmount = sendAmount
            }
            if (receiveAmount) {
              requestBody.receiveAmount = receiveAmount
            }
            return requestBody
          }
        )
    }

    const incomingAmount = {
      ...receiveAmount,
      value: BigInt(1000)
    }

    describe.each`
      toConnection | incomingAmount    | description
      ${true}      | ${undefined}      | ${'connection'}
      ${false}     | ${undefined}      | ${'incomingPayment'}
      ${false}     | ${incomingAmount} | ${'incomingPayment.incomingAmount'}
    `('$description', ({ toConnection, incomingAmount }): void => {
      describe.each`
        sendAmount    | receiveAmount    | paymentType                      | description
        ${sendAmount} | ${undefined}     | ${Pay.PaymentType.FixedSend}     | ${'sendAmount'}
        ${undefined}  | ${receiveAmount} | ${Pay.PaymentType.FixedDelivery} | ${'receiveAmount'}
        ${undefined}  | ${undefined}     | ${Pay.PaymentType.FixedDelivery} | ${'receiver.incomingAmount'}
      `('$description', ({ sendAmount, receiveAmount, paymentType }): void => {
        let options: CreateQuoteOptions
        let incomingPayment: IncomingPayment
        let expected: ExpectedQuote

        beforeEach(async (): Promise<void> => {
          incomingPayment = await createIncomingPayment(deps, {
            paymentPointerId: receivingPaymentPointer.id,
            grantId: grantRef.id,
            incomingAmount
          })
          const connectionService = await deps.use('connectionService')
          options = {
            paymentPointerId,
            receiver: toConnection
              ? connectionService.getUrl(incomingPayment)
              : incomingPayment.url,
            sendAmount,
            receiveAmount
          }
          expected = {
            ...options,
            paymentType
          }
        })

        if (!sendAmount && !receiveAmount && !incomingAmount) {
          it('fails without receiver.incomingAmount', async (): Promise<void> => {
            await expect(quoteService.create(options)).resolves.toEqual(
              QuoteError.InvalidReceiver
            )
          })
        } else {
          if (sendAmount || receiveAmount) {
            it('creates a Quote', async () => {
              const walletScope = mockWalletQuote({
                expected
              })
              const quote = await quoteService.create(options)
              assert.ok(!isQuoteError(quote))
              walletScope.isDone()
              expect(quote).toMatchObject({
                paymentPointerId,
                receiver: options.receiver,
                sendAmount: sendAmount || {
                  value: BigInt(
                    Math.ceil(
                      Number(receiveAmount.value) /
                        quote.minExchangeRate.valueOf()
                    )
                  ),
                  assetCode: asset.code,
                  assetScale: asset.scale
                },
                receiveAmount: receiveAmount || {
                  value: BigInt(
                    Math.ceil(
                      Number(sendAmount.value) * quote.minExchangeRate.valueOf()
                    )
                  ),
                  assetCode: destinationAsset.code,
                  assetScale: destinationAsset.scale
                },
                maxPacketAmount: BigInt('9223372036854775807'),
                createdAt: expect.any(Date),
                updatedAt: expect.any(Date),
                expiresAt: new Date(
                  quote.createdAt.getTime() + config.quoteLifespan
                )
              })
              expect(quote.minExchangeRate.valueOf()).toBe(
                0.5 * (1 - config.slippage)
              )
              expect(quote.lowEstimatedExchangeRate.valueOf()).toBe(0.5)
              expect(quote.highEstimatedExchangeRate.valueOf()).toBe(
                0.500000000001
              )

              await expect(quoteService.get({ id: quote.id })).resolves.toEqual(
                quote
              )
            })

            if (incomingAmount) {
              it('fails if receiveAmount exceeds receiver.incomingAmount', async (): Promise<void> => {
                await incomingPayment.$query(knex).patch({
                  incomingAmount: {
                    value: BigInt(1),
                    assetCode: destinationAsset.code,
                    assetScale: destinationAsset.scale
                  }
                })
                const scope = sendAmount
                  ? mockWalletQuote({
                      expected
                    })
                  : undefined
                await expect(quoteService.create(options)).resolves.toEqual(
                  QuoteError.InvalidAmount
                )
                scope?.isDone()
              })
            }
          } else {
            if (incomingAmount) {
              it('creates a Quote', async () => {
                const scope = mockWalletQuote({
                  expected
                })
                const quote = await quoteService.create(options)
                scope.isDone()
                assert.ok(!isQuoteError(quote))
                expect(quote).toMatchObject({
                  ...options,
                  maxPacketAmount: BigInt('9223372036854775807'),
                  sendAmount: {
                    value: BigInt(
                      Math.ceil(
                        Number(incomingAmount.value) /
                          quote.minExchangeRate.valueOf()
                      )
                    ),
                    assetCode: asset.code,
                    assetScale: asset.scale
                  },
                  receiveAmount: incomingAmount,
                  createdAt: expect.any(Date),
                  updatedAt: expect.any(Date),
                  expiresAt: new Date(
                    quote.createdAt.getTime() + config.quoteLifespan
                  )
                })
                expect(quote.minExchangeRate.valueOf()).toBe(
                  0.5 * (1 - config.slippage)
                )
                expect(quote.lowEstimatedExchangeRate.valueOf()).toBe(0.5)
                expect(quote.highEstimatedExchangeRate.valueOf()).toBe(
                  0.500000000001
                )
                await expect(
                  quoteService.get({ id: quote.id })
                ).resolves.toEqual(quote)
              })
            }
          }

          if (paymentType === Pay.PaymentType.FixedSend) {
            it('uses wallet adjusted receiveAmount', async () => {
              const receiveAmount = {
                value: sendAmount.value / BigInt(3),
                assetCode: destinationAsset.code,
                assetScale: destinationAsset.scale
              }
              const walletScope = mockWalletQuote({
                expected,
                receiveAmount: serializeAmount(receiveAmount)
              })
              const quote = await quoteService.create(options)
              assert.ok(!isQuoteError(quote))
              walletScope.isDone()
              expect(quote).toMatchObject({
                ...options,
                receiveAmount,
                maxPacketAmount: BigInt('9223372036854775807'),
                createdAt: expect.any(Date),
                updatedAt: expect.any(Date),
                expiresAt: new Date(
                  quote.createdAt.getTime() + config.quoteLifespan
                )
              })
              expect(quote.minExchangeRate.valueOf()).toBe(
                0.5 * (1 - config.slippage)
              )
              expect(quote.lowEstimatedExchangeRate.valueOf()).toBe(0.5)
              expect(quote.highEstimatedExchangeRate.valueOf()).toBe(
                0.500000000001
              )

              await expect(quoteService.get({ id: quote.id })).resolves.toEqual(
                quote
              )
            })

            it.each`
              receiveAmount                                                                                 | message
              ${{ value: '100', assetCode: destinationAsset.code, assetScale: destinationAsset.scale }}     | ${'increases receiveAmount'}
              ${{ value: '0', assetCode: destinationAsset.code, assetScale: destinationAsset.scale }}       | ${'returns receiveAmount.value of 0'}
              ${{ value: '-1', assetCode: destinationAsset.code, assetScale: destinationAsset.scale }}      | ${'returns negative receiveAmount.value'}
              ${{ value: 'invalid', assetCode: destinationAsset.code, assetScale: destinationAsset.scale }} | ${'returns invalid receiveAmount.value'}
            `(
              `fails if account provider $message`,
              async ({ receiveAmount }): Promise<void> => {
                const walletScope = mockWalletQuote({
                  expected,
                  receiveAmount
                })
                await expect(quoteService.create(options)).resolves.toEqual(
                  QuoteError.InvalidAmount
                )
                walletScope.isDone()
              }
            )
          } else if (receiveAmount || incomingAmount) {
            it('uses wallet adjusted sendAmount', async () => {
              const sendAmount = {
                value:
                  BigInt(3) * (receiveAmount?.value || incomingAmount.value),
                assetCode: asset.code,
                assetScale: asset.scale
              }
              const walletScope = mockWalletQuote({
                expected,
                sendAmount: serializeAmount(sendAmount)
              })
              const quote = await quoteService.create(options)
              assert.ok(!isQuoteError(quote))
              walletScope.isDone()
              expect(quote).toMatchObject({
                paymentPointerId,
                receiver: options.receiver,
                sendAmount,
                receiveAmount: receiveAmount || incomingAmount,
                maxPacketAmount: BigInt('9223372036854775807'),
                createdAt: expect.any(Date),
                updatedAt: expect.any(Date),
                expiresAt: new Date(
                  quote.createdAt.getTime() + config.quoteLifespan
                )
              })
              expect(quote.minExchangeRate.valueOf()).toBe(
                0.5 * (1 - config.slippage)
              )
              expect(quote.lowEstimatedExchangeRate.valueOf()).toBe(0.5)
              expect(quote.highEstimatedExchangeRate.valueOf()).toBe(
                0.500000000001
              )

              await expect(quoteService.get({ id: quote.id })).resolves.toEqual(
                quote
              )
            })

            it.each`
              sendAmount                                                              | message
              ${{ value: '100', assetCode: asset.code, assetScale: asset.scale }}     | ${'decreases sendAmount'}
              ${{ value: '0', assetCode: asset.code, assetScale: asset.scale }}       | ${'returns sendAmount.value of 0'}
              ${{ value: '-1', assetCode: asset.code, assetScale: asset.scale }}      | ${'returns negative sendAmount.value'}
              ${{ value: 'invalid', assetCode: asset.code, assetScale: asset.scale }} | ${'returns invalid sendAmount.value'}
            `(
              `fails if account provider $message`,
              async ({ sendAmount }): Promise<void> => {
                const walletScope = mockWalletQuote({
                  expected,
                  sendAmount
                })
                await expect(quoteService.create(options)).resolves.toEqual(
                  QuoteError.InvalidAmount
                )
                walletScope.isDone()
              }
            )
          }

          it('fails if wallet does not respond 201', async (): Promise<void> => {
            const walletScope = mockWalletQuote({
              expected,
              status: 403
            })
            await expect(quoteService.create(options)).rejects.toThrowError(
              'Request failed with status code 403'
            )
            walletScope.isDone()
          })

          if (!toConnection) {
            test.each`
              state
              ${IncomingPaymentState.Completed}
              ${IncomingPaymentState.Expired}
            `(
              `returns ${QuoteError.InvalidReceiver} on $state receiver`,
              async ({ state }): Promise<void> => {
                await incomingPayment.$query(knex).patch({
                  state,
                  expiresAt:
                    state === IncomingPaymentState.Expired
                      ? new Date()
                      : undefined
                })
                await expect(quoteService.create(options)).resolves.toEqual(
                  QuoteError.InvalidReceiver
                )
              }
            )
          }
        }
      })
    })

    it('fails on unknown payment pointer', async (): Promise<void> => {
      await expect(
        quoteService.create({
          paymentPointerId: uuid(),
          receiver: `${
            receivingPaymentPointer.url
          }/incoming-payments/${uuid()}`,
          sendAmount
        })
      ).resolves.toEqual(QuoteError.UnknownPaymentPointer)
    })

    it('fails on invalid receiver', async (): Promise<void> => {
      await expect(
        quoteService.create({
          paymentPointerId,
          receiver: `${
            receivingPaymentPointer.url
          }/incoming-payments/${uuid()}`,
          sendAmount
        })
      ).resolves.toEqual(QuoteError.InvalidReceiver)
    })

    test.each`
      sendAmount                              | receiveAmount                              | description
      ${sendAmount}                           | ${receiveAmount}                           | ${'with multiple amounts'}
      ${{ ...sendAmount, value: BigInt(0) }}  | ${undefined}                               | ${'with sendAmount of zero'}
      ${{ ...sendAmount, value: BigInt(-1) }} | ${undefined}                               | ${'with negative sendAmount'}
      ${{ ...sendAmount, assetScale: 3 }}     | ${undefined}                               | ${'with wrong sendAmount asset'}
      ${undefined}                            | ${{ ...receiveAmount, value: BigInt(0) }}  | ${'with receiveAmount of zero'}
      ${undefined}                            | ${{ ...receiveAmount, value: BigInt(-1) }} | ${'with negative receiveAmount'}
      ${undefined}                            | ${{ ...receiveAmount, assetScale: 3 }}     | ${'with wrong receiveAmount asset'}
    `(
      'fails to create $description',
      async ({ sendAmount, receiveAmount }): Promise<void> => {
        await expect(
          quoteService.create({
            paymentPointerId,
            receiver: (
              await createIncomingPayment(deps, {
                paymentPointerId: receivingPaymentPointer.id,
                grantId: grantRef.id
              })
            ).url,
            sendAmount,
            receiveAmount
          })
        ).resolves.toEqual(QuoteError.InvalidAmount)
      }
    )

    it('fails on rate service error', async (): Promise<void> => {
      const ratesService = await deps.use('ratesService')
      jest
        .spyOn(ratesService, 'prices')
        .mockImplementation(() => Promise.reject(new Error('fail')))
      await expect(
        quoteService.create({
          paymentPointerId,
          receiver: (
            await createIncomingPayment(deps, {
              paymentPointerId: receivingPaymentPointer.id,
              grantId: grantRef.id
            })
          ).url,
          sendAmount
        })
      ).rejects.toThrow('missing prices')
    })
  })

  describe('getPaymentPointerPage', (): void => {
    getPageTests({
      createModel: async () =>
        Quote.query(knex).insertAndFetch({
          paymentPointerId,
          assetId,
          receiver: `${
            receivingPaymentPointer.url
          }/incoming-payments/${uuid()}`,
          sendAmount,
          receiveAmount,
          maxPacketAmount: BigInt('9223372036854775807'),
          lowEstimatedExchangeRate: Pay.Ratio.of(
            Pay.Int.from(500000000000n) as Pay.PositiveInt,
            Pay.Int.from(1000000000000n) as Pay.PositiveInt
          ),
          highEstimatedExchangeRate: Pay.Ratio.of(
            Pay.Int.from(500000000001n) as Pay.PositiveInt,
            Pay.Int.from(1000000000000n) as Pay.PositiveInt
          ),
          minExchangeRate: Pay.Ratio.of(
            Pay.Int.from(495n) as Pay.PositiveInt,
            Pay.Int.from(1000n) as Pay.PositiveInt
          ),
          expiresAt: new Date(Date.now() + config.quoteLifespan)
        }),
      getPage: (pagination: Pagination) =>
        quoteService.getPaymentPointerPage(paymentPointerId, pagination)
    })
  })
})
