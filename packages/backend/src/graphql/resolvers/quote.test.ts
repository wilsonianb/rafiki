import { gql } from 'apollo-server-koa'
import assert from 'assert'
import Knex from 'knex'
import { v4 as uuid } from 'uuid'

import { getPageTests } from './page.test'
import { createTestApp, TestContainer } from '../../tests/app'
import { IocContract } from '@adonisjs/fold'
import { AppServices } from '../../app'
import { initIocContainer } from '../..'
import { Config } from '../../config/app'
import { randomAsset } from '../../tests/asset'
import { createQuote } from '../../tests/quote'
import { truncateTables } from '../../tests/tableManager'
import { QuoteError, errorToMessage } from '../../open_payments/quote/errors'
import { QuoteService } from '../../open_payments/quote/service'
import { Quote as QuoteModel } from '../../open_payments/quote/model'
import { AccountService } from '../../open_payments/account/service'
import { isIncomingPaymentError } from '../../open_payments/payment/incoming/errors'
import { Amount } from '../../open_payments/payment/amount'
import { Quote, QuoteResponse } from '../generated/graphql'

describe('Quote Resolvers', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let knex: Knex
  let quoteService: QuoteService
  let accountService: AccountService

  const asset = randomAsset()

  beforeAll(
    async (): Promise<void> => {
      deps = await initIocContainer(Config)
      appContainer = await createTestApp(deps)
      knex = await deps.use('knex')
      quoteService = await deps.use('quoteService')
      accountService = await deps.use('accountService')
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
      await appContainer.apolloClient.stop()
      await appContainer.shutdown()
    }
  )

  const createAccountQuote = async (accountId: string): Promise<QuoteModel> => {
    const receiveAsset = randomAsset()
    const { id: receivingAccountId } = await accountService.create({
      asset: receiveAsset
    })
    return await createQuote({
      accountId,
      receivingAccount: `${Config.publicHost}/${receivingAccountId}`,
      receiveAmount: {
        value: BigInt(56),
        assetCode: receiveAsset.code,
        assetScale: receiveAsset.scale
      }
    })
  }

  describe('Query.quote', (): void => {
    test('200', async (): Promise<void> => {
      const { id: accountId } = await accountService.create({
        asset
      })
      const quote = await createAccountQuote(accountId)

      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Quote($quoteId: String!) {
              quote(id: $quoteId) {
                id
                accountId
                receivingPayment
                sendAmount {
                  value
                  assetCode
                  assetScale
                }
                receiveAmount {
                  value
                  assetCode
                  assetScale
                }
                maxPacketAmount
                minExchangeRate
                lowEstimatedExchangeRate
                highEstimatedExchangeRate
                createdAt
                expiresAt
              }
            }
          `,
          variables: {
            quoteId: quote.id
          }
        })
        .then((query): Quote => query.data?.quote)

      expect(query).toEqual({
        id: quote.id,
        accountId,
        receivingPayment: quote.receivingPayment,
        sendAmount: {
          value: quote.sendAmount.value.toString(),
          assetCode: quote.sendAmount.assetCode,
          assetScale: quote.sendAmount.assetScale,
          __typename: 'Amount'
        },
        receiveAmount: {
          value: quote.receiveAmount.value.toString(),
          assetCode: quote.receiveAmount.assetCode,
          assetScale: quote.receiveAmount.assetScale,
          __typename: 'Amount'
        },
        maxPacketAmount: quote.maxPacketAmount.toString(),
        minExchangeRate: quote.minExchangeRate.valueOf(),
        lowEstimatedExchangeRate: quote.lowEstimatedExchangeRate.valueOf(),
        highEstimatedExchangeRate: quote.highEstimatedExchangeRate.valueOf(),
        createdAt: quote.createdAt.toISOString(),
        expiresAt: quote.expiresAt.toISOString(),
        __typename: 'Quote'
      })
    })

    test('404', async (): Promise<void> => {
      jest.spyOn(quoteService, 'get').mockImplementation(async () => undefined)

      await expect(
        appContainer.apolloClient.query({
          query: gql`
            query Quote($quoteId: String!) {
              quote(id: $quoteId) {
                id
              }
            }
          `,
          variables: { quoteId: uuid() }
        })
      ).rejects.toThrow('quote does not exist')
    })
  })

  describe('Mutation.createQuote', (): void => {
    const receiveAsset = {
      code: 'XRP',
      scale: 9
    }
    const sendAmount: Amount = {
      value: BigInt(123),
      assetCode: asset.code,
      assetScale: asset.scale
    }
    const receiveAmount: Amount = {
      value: BigInt(56),
      assetCode: receiveAsset.code,
      assetScale: receiveAsset.scale
    }

    const input = {
      accountId: uuid(),
      receivingAccount: 'http://wallet2.example/bob',
      sendAmount
    }

    test.each`
      toAccount | toPayment | sendAmount    | receiveAmount    | type
      ${true}   | ${false}  | ${sendAmount} | ${undefined}     | ${'fixed send to account'}
      ${true}   | ${false}  | ${undefined}  | ${receiveAmount} | ${'fixed receive to account'}
      ${false}  | ${true}   | ${sendAmount} | ${undefined}     | ${'fixed send to incoming payment'}
      ${false}  | ${true}   | ${undefined}  | ${receiveAmount} | ${'fixed receive to incoming payment'}
      ${false}  | ${true}   | ${undefined}  | ${undefined}     | ${'incoming payment'}
    `(
      '200 ($type)',
      async ({
        toAccount,
        toPayment,
        sendAmount,
        receiveAmount
      }): Promise<void> => {
        const { id: accountId } = await accountService.create({
          asset
        })
        const { id: receivingAccountId } = await accountService.create({
          asset: {
            code: receiveAsset.code,
            scale: receiveAsset.scale
          }
        })
        const receivingAccount = toAccount
          ? `${Config.publicHost}/${receivingAccountId}`
          : undefined
        let receivingPayment: string | undefined
        if (toPayment) {
          const incomingPaymentService = await deps.use(
            'incomingPaymentService'
          )
          const incomingPayment = await incomingPaymentService.create({
            accountId: receivingAccountId,
            incomingAmount: receiveAmount
              ? undefined
              : {
                  value: BigInt(56),
                  assetCode: receiveAsset.code,
                  assetScale: receiveAsset.scale
                }
          })
          assert.ok(!isIncomingPaymentError(incomingPayment))
          receivingPayment = `${Config.publicHost}/${receivingAccountId}/incoming-payments/${incomingPayment.id}`
        }

        const input = {
          accountId,
          receivingAccount,
          sendAmount,
          receiveAmount,
          receivingPayment
        }
        const quote = await createQuote(input)

        const createSpy = jest
          .spyOn(quoteService, 'create')
          .mockResolvedValueOnce(quote)

        const query = await appContainer.apolloClient
          .query({
            query: gql`
              mutation CreateQuote($input: CreateQuoteInput!) {
                createQuote(input: $input) {
                  code
                  success
                  quote {
                    id
                  }
                }
              }
            `,
            variables: { input }
          })
          .then((query): QuoteResponse => query.data?.createQuote)

        expect(createSpy).toHaveBeenCalledWith(input)
        expect(query.code).toBe('200')
        expect(query.success).toBe(true)
        expect(query.quote?.id).toBe(quote.id)
      }
    )

    test('400', async (): Promise<void> => {
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            mutation CreateQuote($input: CreateQuoteInput!) {
              createQuote(input: $input) {
                code
                success
                message
                quote {
                  id
                }
              }
            }
          `,
          variables: { input }
        })
        .then((query): QuoteResponse => query.data?.createQuote)
      expect(query.code).toBe('404')
      expect(query.success).toBe(false)
      expect(query.message).toBe(errorToMessage[QuoteError.UnknownAccount])
      expect(query.quote).toBeNull()
    })

    test('500', async (): Promise<void> => {
      const createSpy = jest
        .spyOn(quoteService, 'create')
        .mockRejectedValueOnce(new Error('unexpected'))

      const query = await appContainer.apolloClient
        .query({
          query: gql`
            mutation CreateQuote($input: CreateQuoteInput!) {
              createQuote(input: $input) {
                code
                success
                message
                quote {
                  id
                }
              }
            }
          `,
          variables: { input }
        })
        .then((query): QuoteResponse => query.data?.createQuote)
      expect(createSpy).toHaveBeenCalledWith(input)
      expect(query.code).toBe('500')
      expect(query.success).toBe(false)
      expect(query.message).toBe('Error trying to create quote')
      expect(query.quote).toBeNull()
    })
  })

  describe('Account quotes', (): void => {
    let accountId: string

    beforeEach(
      async (): Promise<void> => {
        accountId = (
          await accountService.create({
            asset
          })
        ).id
      }
    )

    getPageTests({
      getClient: () => appContainer.apolloClient,
      createModel: () => createAccountQuote(accountId),
      pagedQuery: 'quotes',
      parent: {
        query: 'account',
        getId: () => accountId
      }
    })
  })
})
