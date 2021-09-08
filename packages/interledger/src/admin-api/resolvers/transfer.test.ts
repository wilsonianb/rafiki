import { Model } from 'objection'
import { Transaction } from 'knex'
import { v4 as uuid } from 'uuid'

import { AccountFactory, randomAsset } from '../../accounts/testsHelpers'
import {
  TransferInput,
  TransferMutationResponse,
  TransferError
} from '../generated/graphql'
import { gql } from 'apollo-server'

import { createTestApp, TestContainer } from '../testsHelpers/app'

describe('Deposit Resolvers', (): void => {
  let accountFactory: AccountFactory
  let appContainer: TestContainer
  let trx: Transaction

  beforeAll(
    async (): Promise<void> => {
      appContainer = await createTestApp()
      accountFactory = new AccountFactory(appContainer.accountsService)
    }
  )

  beforeEach(
    async (): Promise<void> => {
      trx = await appContainer.knex.transaction()
      Model.knex(trx)
    }
  )

  afterEach(
    async (): Promise<void> => {
      await trx.rollback()
      await trx.destroy()
    }
  )

  afterAll(
    async (): Promise<void> => {
      await appContainer.shutdown()
    }
  )

  describe('Create Transfer', (): void => {
    test('Can create an ilp account transfer', async (): Promise<void> => {
      const { id: sourceAccountId, asset } = await accountFactory.build()
      const { id: destinationAccountId } = await accountFactory.build({ asset })
      const amount = '100'
      await appContainer.accountsService.deposit({
        accountId: sourceAccountId,
        amount: BigInt(amount)
      })
      const transfer: TransferInput = {
        sourceAccountId,
        destinationAccountId,
        sourceAmount: amount,
        idempotencyKey: uuid()
      }
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation Transfer($input: TransferInput!) {
              transfer(input: $input) {
                code
                success
                message
              }
            }
          `,
          variables: {
            input: transfer
          }
        })
        .then(
          (query): TransferMutationResponse => {
            if (query.data) {
              return query.data.transfer
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
    })

    test.each`
      srcAmt | destAmt
      ${1}   | ${1}
      ${1}   | ${undefined}
      ${1}   | ${2}
      ${2}   | ${1}
    `(
      'Can create an ilp account transfer { srcAmt: $srcAmt, destAmt: $destAmt }',
      async ({ srcAmt, destAmt }): Promise<void> => {
        const { id: sourceAccountId, asset } = await accountFactory.build()
        const { id: destinationAccountId } = await accountFactory.build({
          asset
        })

        const startingSourceBalance = BigInt(10)
        await appContainer.accountsService.deposit({
          accountId: sourceAccountId,
          amount: startingSourceBalance
        })

        const startingLiquidity = BigInt(100)
        await appContainer.accountsService.depositLiquidity({
          asset,
          amount: startingLiquidity
        })

        const transfer: TransferInput = {
          sourceAccountId,
          destinationAccountId,
          sourceAmount: srcAmt.toString(),
          destinationAmount: destAmt ? destAmt.toString() : undefined,
          idempotencyKey: uuid()
        }
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation Transfer($input: TransferInput!) {
                transfer(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: transfer
            }
          })
          .then(
            (query): TransferMutationResponse => {
              if (query.data) {
                return query.data.transfer
              } else {
                throw new Error('Data was empty')
              }
            }
          )

        expect(response.success).toBe(true)
        expect(response.code).toEqual('200')
        expect(response.error).toBeNull()

        const sourceAmount = BigInt(srcAmt)
        const destinationAmount = destAmt ? BigInt(destAmt) : sourceAmount
        const amountDiff = destinationAmount - sourceAmount

        await expect(
          appContainer.accountsService.getAccountBalance(sourceAccountId)
        ).resolves.toMatchObject({
          balance: startingSourceBalance - sourceAmount
        })

        await expect(
          appContainer.accountsService.getLiquidityBalance(asset)
        ).resolves.toEqual(startingLiquidity - amountDiff)

        await expect(
          appContainer.accountsService.getAccountBalance(destinationAccountId)
        ).resolves.toMatchObject({
          balance: destinationAmount
        })
      }
    )

    test.each`
      sameAssetCode
      ${true}
      ${false}
    `(
      'Can create a cross-currency ilp account transfer { sameAssetCode: sameAssetCode }',
      async ({ sameAssetCode }): Promise<void> => {
        const {
          id: sourceAccountId,
          asset: sourceAsset
        } = await accountFactory.build({
          asset: {
            code: randomAsset().code,
            scale: 10
          }
        })
        const {
          id: destinationAccountId,
          asset: destinationAsset
        } = await accountFactory.build({
          asset: {
            code: sameAssetCode ? sourceAsset.code : randomAsset().code,
            scale: sourceAsset.scale + 2
          }
        })

        const startingSourceBalance = BigInt(10)
        await appContainer.accountsService.deposit({
          accountId: sourceAccountId,
          amount: startingSourceBalance
        })

        const startingDestinationLiquidity = BigInt(100)
        await appContainer.accountsService.depositLiquidity({
          asset: destinationAsset,
          amount: startingDestinationLiquidity
        })

        const sourceAmount = BigInt(1)
        const destinationAmount = BigInt(2)
        const transfer: TransferInput = {
          sourceAccountId,
          destinationAccountId,
          sourceAmount: sourceAmount.toString(),
          destinationAmount: destinationAmount.toString(),
          idempotencyKey: uuid()
        }
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation Transfer($input: TransferInput!) {
                transfer(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: transfer
            }
          })
          .then(
            (query): TransferMutationResponse => {
              if (query.data) {
                return query.data.transfer
              } else {
                throw new Error('Data was empty')
              }
            }
          )

        expect(response.success).toBe(true)
        expect(response.code).toEqual('200')
        expect(response.error).toBeNull()

        await expect(
          appContainer.accountsService.getAccountBalance(sourceAccountId)
        ).resolves.toMatchObject({
          balance: startingSourceBalance - sourceAmount
        })

        await expect(
          appContainer.accountsService.getLiquidityBalance(sourceAsset)
        ).resolves.toEqual(sourceAmount)

        await expect(
          appContainer.accountsService.getLiquidityBalance(destinationAsset)
        ).resolves.toEqual(startingDestinationLiquidity - destinationAmount)

        await expect(
          appContainer.accountsService.getAccountBalance(destinationAccountId)
        ).resolves.toMatchObject({
          balance: destinationAmount
        })
      }
    )

    test('Returns error for insufficient source balance', async (): Promise<void> => {
      const { id: sourceAccountId, asset } = await accountFactory.build()
      const { id: destinationAccountId } = await accountFactory.build({
        asset
      })
      const transfer: TransferInput = {
        sourceAccountId,
        destinationAccountId,
        sourceAmount: '5',
        idempotencyKey: uuid()
      }
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation Transfer($input: TransferInput!) {
              transfer(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: transfer
          }
        })
        .then(
          (query): TransferMutationResponse => {
            if (query.data) {
              return query.data.transfer
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('403')
      expect(response.message).toEqual('Insufficient balance')
      expect(response.error).toEqual(TransferError.InsufficientBalance)
    })

    test.each`
      sameAsset
      ${true}
      ${false}
    `(
      'Returns error for insufficient destination liquidity balance { sameAsset: $sameAsset }',
      async ({ sameAsset }): Promise<void> => {
        const {
          id: sourceAccountId,
          asset: sourceAsset
        } = await accountFactory.build()
        const { id: destinationAccountId } = await accountFactory.build({
          asset: sameAsset ? sourceAsset : randomAsset()
        })
        const startingSourceBalance = BigInt(10)
        await appContainer.accountsService.deposit({
          accountId: sourceAccountId,
          amount: startingSourceBalance
        })
        const transfer: TransferInput = {
          sourceAccountId,
          destinationAccountId,
          sourceAmount: '5',
          destinationAmount: '10',
          idempotencyKey: uuid()
        }
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation Transfer($input: TransferInput!) {
                transfer(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: transfer
            }
          })
          .then(
            (query): TransferMutationResponse => {
              if (query.data) {
                return query.data.transfer
              } else {
                throw new Error('Data was empty')
              }
            }
          )

        expect(response.success).toBe(false)
        expect(response.code).toEqual('403')
        expect(response.message).toEqual('Insufficient liquidity')
        expect(response.error).toEqual(TransferError.InsufficientLiquidity)
      }
    )

    test('Returns error for nonexistent account', async (): Promise<void> => {
      const transfer: TransferInput = {
        sourceAccountId: uuid(),
        destinationAccountId: uuid(),
        sourceAmount: '5',
        idempotencyKey: uuid()
      }
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation Transfer($input: TransferInput!) {
              transfer(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: transfer
          }
        })
        .then(
          (query): TransferMutationResponse => {
            if (query.data) {
              return query.data.transfer
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown source account')
      expect(response.error).toEqual(TransferError.UnknownSourceAccount)

      {
        ;({ id: transfer.sourceAccountId } = await accountFactory.build())
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation Transfer($input: TransferInput!) {
                transfer(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: transfer
            }
          })
          .then(
            (query): TransferMutationResponse => {
              if (query.data) {
                return query.data.transfer
              } else {
                throw new Error('Data was empty')
              }
            }
          )

        expect(response.success).toBe(false)
        expect(response.code).toEqual('404')
        expect(response.message).toEqual('Unknown destination account')
        expect(response.error).toEqual(TransferError.UnknownDestinationAccount)
      }
    })

    test('Returns error for same accounts', async (): Promise<void> => {
      const { id } = await accountFactory.build()

      const transfer: TransferInput = {
        sourceAccountId: id,
        destinationAccountId: id,
        sourceAmount: '5',
        idempotencyKey: uuid()
      }
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation Transfer($input: TransferInput!) {
              transfer(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: transfer
          }
        })
        .then(
          (query): TransferMutationResponse => {
            if (query.data) {
              return query.data.transfer
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Same accounts')
      expect(response.error).toEqual(TransferError.SameAccounts)
    })

    test('Returns error for invalid source amount', async (): Promise<void> => {
      const { id: sourceAccountId, asset } = await accountFactory.build()
      const { id: destinationAccountId } = await accountFactory.build({
        asset
      })
      const transfer: TransferInput = {
        sourceAccountId,
        destinationAccountId,
        sourceAmount: '0',
        idempotencyKey: uuid()
      }
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation Transfer($input: TransferInput!) {
              transfer(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: transfer
          }
        })
        .then(
          (query): TransferMutationResponse => {
            if (query.data) {
              return query.data.transfer
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid source amount')
      expect(response.error).toEqual(TransferError.InvalidSourceAmount)

      {
        transfer.sourceAmount = '-1'
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation Transfer($input: TransferInput!) {
                transfer(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: transfer
            }
          })
          .then(
            (query): TransferMutationResponse => {
              if (query.data) {
                return query.data.transfer
              } else {
                throw new Error('Data was empty')
              }
            }
          )

        expect(response.success).toBe(false)
        expect(response.code).toEqual('400')
        expect(response.message).toEqual('Invalid source amount')
        expect(response.error).toEqual(TransferError.InvalidSourceAmount)
      }
    })

    test('Returns error for invalid destination amount', async (): Promise<void> => {
      const { id: sourceAccountId, asset } = await accountFactory.build()
      const { id: destinationAccountId } = await accountFactory.build({
        asset
      })
      const transfer: TransferInput = {
        sourceAccountId,
        destinationAccountId,
        sourceAmount: '5',
        destinationAmount: '0',
        idempotencyKey: uuid()
      }
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation Transfer($input: TransferInput!) {
              transfer(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: transfer
          }
        })
        .then(
          (query): TransferMutationResponse => {
            if (query.data) {
              return query.data.transfer
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid destination amount')
      expect(response.error).toEqual(TransferError.InvalidDestinationAmount)

      {
        transfer.destinationAmount = '-1'
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation Transfer($input: TransferInput!) {
                transfer(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: transfer
            }
          })
          .then(
            (query): TransferMutationResponse => {
              if (query.data) {
                return query.data.transfer
              } else {
                throw new Error('Data was empty')
              }
            }
          )

        expect(response.success).toBe(false)
        expect(response.code).toEqual('400')
        expect(response.message).toEqual('Invalid destination amount')
        expect(response.error).toEqual(TransferError.InvalidDestinationAmount)
      }
    })

    test.each`
      sameAssetCode
      ${true}
      ${false}
    `(
      'Returns error for missing destination amount { sameAssetCode: sameAssetCode }',
      async ({ sameAssetCode }): Promise<void> => {
        const {
          id: sourceAccountId,
          asset: sourceAsset
        } = await accountFactory.build({
          asset: {
            code: randomAsset().code,
            scale: 10
          }
        })
        const { id: destinationAccountId } = await accountFactory.build({
          asset: {
            code: sameAssetCode ? sourceAsset.code : randomAsset().code,
            scale: sourceAsset.scale + 2
          }
        })

        const transfer: TransferInput = {
          sourceAccountId,
          destinationAccountId,
          sourceAmount: '5',
          idempotencyKey: uuid()
        }
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation Transfer($input: TransferInput!) {
                transfer(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: transfer
            }
          })
          .then(
            (query): TransferMutationResponse => {
              if (query.data) {
                return query.data.transfer
              } else {
                throw new Error('Data was empty')
              }
            }
          )

        expect(response.success).toBe(false)
        expect(response.code).toEqual('400')
        expect(response.message).toEqual('Invalid destination amount')
        expect(response.error).toEqual(TransferError.InvalidDestinationAmount)
      }
    )

    test.todo('Returns error timed out transfer')
  })
})
