import assert from 'assert'
import { gql } from 'apollo-server-koa'
import Knex from 'knex'
import { v4 as uuid } from 'uuid'

import { createTestApp, TestContainer } from '../../tests/app'
import { IocContract } from '@adonisjs/fold'
import { AppServices } from '../../app'
import { initIocContainer } from '../..'
import { Config } from '../../config/app'
import { AccountingService, Deposit } from '../../accounting/service'
import { AssetService } from '../../asset/service'
import { AccountService } from '../../open_payments/account/service'
import { InvoiceService } from '../../open_payments/invoice/service'
import { randomAsset, randomUnit } from '../../tests/asset'
import { PaymentFactory } from '../../tests/paymentFactory'
import { PeerFactory } from '../../tests/peerFactory'
import { truncateTables } from '../../tests/tableManager'
import {
  LiquidityError,
  LiquidityMutationResponse,
  AccountWithdrawalMutationResponse,
  InvoiceWithdrawalMutationResponse,
  OutgoingPaymentWithdrawalMutationResponse
} from '../generated/graphql'

describe('Withdrawal Resolvers', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let accountService: AccountService
  let accountingService: AccountingService
  let assetService: AssetService
  let invoiceService: InvoiceService
  let paymentFactory: PaymentFactory
  let peerFactory: PeerFactory
  let knex: Knex
  const timeout = BigInt(10e9) // 10 seconds

  beforeAll(
    async (): Promise<void> => {
      deps = await initIocContainer(Config)
      appContainer = await createTestApp(deps)
      knex = await deps.use('knex')
      accountService = await deps.use('accountService')
      accountingService = await deps.use('accountingService')
      assetService = await deps.use('assetService')
      invoiceService = await deps.use('invoiceService')
      paymentFactory = new PaymentFactory(deps)
      const peerService = await deps.use('peerService')
      peerFactory = new PeerFactory(peerService)
    }
  )

  afterAll(
    async (): Promise<void> => {
      await truncateTables(knex)
      await appContainer.apolloClient.stop()
      await appContainer.shutdown()
    }
  )

  describe('Add peer liquidity', (): void => {
    let peerId: string

    beforeEach(
      async (): Promise<void> => {
        peerId = (await peerFactory.build()).id
      }
    )

    test('Can add liquidity to peer', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddPeerLiquidity($input: AddPeerLiquidityInput!) {
              addPeerLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              peerId,
              amount: '100'
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.addPeerLiquidity
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
      expect(response.error).toBeNull()
    })

    test('Returns an error for invalid id', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddPeerLiquidity($input: AddPeerLiquidityInput!) {
              addPeerLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: 'not a uuid v4',
              peerId,
              amount: '100'
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.addPeerLiquidity
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid id')
      expect(response.error).toEqual(LiquidityError.InvalidId)
    })

    test('Returns an error for unknown peer', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddPeerLiquidity($input: AddPeerLiquidityInput!) {
              addPeerLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              peerId: uuid(),
              amount: '100'
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.addPeerLiquidity
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown peer')
      expect(response.error).toEqual(LiquidityError.UnknownPeer)
    })

    test('Returns an error for existing transfer', async (): Promise<void> => {
      const id = uuid()
      await expect(
        accountingService.createDeposit({
          id,
          accountId: peerId,
          amount: BigInt(100)
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddPeerLiquidity($input: AddPeerLiquidityInput!) {
              addPeerLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id,
              peerId,
              amount: '100'
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.addPeerLiquidity
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('409')
      expect(response.message).toEqual('Transfer exists')
      expect(response.error).toEqual(LiquidityError.TransferExists)
    })

    test('Returns an error for zero amount', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddPeerLiquidity($input: AddPeerLiquidityInput!) {
              addPeerLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: 'not a uuid v4',
              peerId,
              amount: '0'
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.addPeerLiquidity
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Amount is zero')
      expect(response.error).toEqual(LiquidityError.AmountZero)
    })
  })

  describe('Add asset liquidity', (): void => {
    let assetId: string
    let unit: number

    beforeEach(
      async (): Promise<void> => {
        const asset = await assetService.getOrCreate(randomAsset())
        assetId = asset.id
        unit = asset.unit
      }
    )

    test('Can add liquidity to asset', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddAssetLiquidity($input: AddAssetLiquidityInput!) {
              addAssetLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              assetId,
              amount: '100'
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.addAssetLiquidity
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
      expect(response.error).toBeNull()
    })

    test('Returns an error for invalid id', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddAssetLiquidity($input: AddAssetLiquidityInput!) {
              addAssetLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: 'not a uuid',
              assetId,
              amount: '100'
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.addAssetLiquidity
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid id')
      expect(response.error).toEqual(LiquidityError.InvalidId)
    })

    test('Returns an error for unknown asset', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddAssetLiquidity($input: AddAssetLiquidityInput!) {
              addAssetLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              assetId: uuid(),
              amount: '100'
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.addAssetLiquidity
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown asset')
      expect(response.error).toEqual(LiquidityError.UnknownAsset)
    })

    test('Returns an error for existing transfer', async (): Promise<void> => {
      const id = uuid()
      await expect(
        accountingService.createDeposit({
          id,
          asset: {
            unit
          },
          amount: BigInt(100)
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddAssetLiquidity($input: AddAssetLiquidityInput!) {
              addAssetLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id,
              assetId,
              amount: '100'
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.addAssetLiquidity
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('409')
      expect(response.message).toEqual('Transfer exists')
      expect(response.error).toEqual(LiquidityError.TransferExists)
    })

    test('Returns an error for zero amount', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddAssetLiquidity($input: AddAssetLiquidityInput!) {
              addAssetLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              assetId,
              amount: '0'
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.addAssetLiquidity
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Amount is zero')
      expect(response.error).toEqual(LiquidityError.AmountZero)
    })
  })

  describe('Create peer liquidity withdrawal', (): void => {
    let peerId: string
    const startingBalance = BigInt(100)

    beforeEach(
      async (): Promise<void> => {
        const peer = await peerFactory.build()
        await expect(
          accountingService.createDeposit({
            id: uuid(),
            accountId: peer.id,
            amount: startingBalance
          })
        ).resolves.toBeUndefined()
        peerId = peer.id
      }
    )

    test('Can create liquidity withdrawal from peer', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreatePeerLiquidityWithdrawal(
              $input: CreatePeerLiquidityWithdrawalInput!
            ) {
              createPeerLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              peerId,
              amount: startingBalance.toString()
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.createPeerLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
      expect(response.error).toBeNull()
    })

    test('Returns an error for unknown peer', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreatePeerLiquidityWithdrawal(
              $input: CreatePeerLiquidityWithdrawalInput!
            ) {
              createPeerLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              peerId: uuid(),
              amount: '100'
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.createPeerLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown peer')
      expect(response.error).toEqual(LiquidityError.UnknownPeer)
    })

    test('Returns an error for invalid id', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreatePeerLiquidityWithdrawal(
              $input: CreatePeerLiquidityWithdrawalInput!
            ) {
              createPeerLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: 'not a uuid',
              peerId,
              amount: startingBalance.toString()
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.createPeerLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid id')
      expect(response.error).toEqual(LiquidityError.InvalidId)
    })

    test('Returns an error for existing transfer', async (): Promise<void> => {
      const id = uuid()
      await expect(
        accountingService.createDeposit({
          id,
          accountId: peerId,
          amount: BigInt(10)
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreatePeerLiquidityWithdrawal(
              $input: CreatePeerLiquidityWithdrawalInput!
            ) {
              createPeerLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id,
              peerId,
              amount: startingBalance.toString()
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.createPeerLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(response.success).toBe(false)
      expect(response.code).toEqual('409')
      expect(response.message).toEqual('Transfer exists')
      expect(response.error).toEqual(LiquidityError.TransferExists)
    })

    test.each`
      amount                         | code     | message                   | error
      ${startingBalance + BigInt(1)} | ${'403'} | ${'Insufficient balance'} | ${LiquidityError.InsufficientBalance}
      ${BigInt(0)}                   | ${'400'} | ${'Amount is zero'}       | ${LiquidityError.AmountZero}
    `(
      'Returns error for $error',
      async ({ amount, code, message, error }): Promise<void> => {
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation CreatePeerLiquidityWithdrawal(
                $input: CreatePeerLiquidityWithdrawalInput!
              ) {
                createPeerLiquidityWithdrawal(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: {
                id: uuid(),
                peerId,
                amount: amount.toString()
              }
            }
          })
          .then(
            (query): LiquidityMutationResponse => {
              if (query.data) {
                return query.data.createPeerLiquidityWithdrawal
              } else {
                throw new Error('Data was empty')
              }
            }
          )

        expect(response.success).toBe(false)
        expect(response.code).toEqual(code)
        expect(response.message).toEqual(message)
        expect(response.error).toEqual(error)
      }
    )
  })

  describe('Create asset liquidity withdrawal', (): void => {
    let assetId: string
    let unit: number
    const startingBalance = BigInt(100)

    beforeEach(
      async (): Promise<void> => {
        const asset = await assetService.getOrCreate(randomAsset())
        await expect(
          accountingService.createDeposit({
            id: uuid(),
            asset: {
              unit: asset.unit
            },
            amount: startingBalance
          })
        ).resolves.toBeUndefined()
        assetId = asset.id
        unit = asset.unit
      }
    )

    test('Can create liquidity withdrawal from asset', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAssetLiquidityWithdrawal(
              $input: CreateAssetLiquidityWithdrawalInput!
            ) {
              createAssetLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              assetId,
              amount: startingBalance.toString()
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.createAssetLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
      expect(response.error).toBeNull()
    })

    test('Returns an error for unknown asset', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAssetLiquidityWithdrawal(
              $input: CreateAssetLiquidityWithdrawalInput!
            ) {
              createAssetLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              assetId: uuid(),
              amount: '100'
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.createAssetLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown asset')
      expect(response.error).toEqual(LiquidityError.UnknownAsset)
    })

    test('Returns an error for invalid id', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAssetLiquidityWithdrawal(
              $input: CreateAssetLiquidityWithdrawalInput!
            ) {
              createAssetLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: 'not a uuid',
              assetId,
              amount: startingBalance.toString()
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.createAssetLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid id')
      expect(response.error).toEqual(LiquidityError.InvalidId)
    })

    test('Returns an error for existing transfer', async (): Promise<void> => {
      const id = uuid()
      await expect(
        accountingService.createDeposit({
          id,
          asset: {
            unit
          },
          amount: BigInt(10)
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAssetLiquidityWithdrawal(
              $input: CreateAssetLiquidityWithdrawalInput!
            ) {
              createAssetLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id,
              assetId,
              amount: startingBalance.toString()
            }
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.createAssetLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(response.success).toBe(false)
      expect(response.code).toEqual('409')
      expect(response.message).toEqual('Transfer exists')
      expect(response.error).toEqual(LiquidityError.TransferExists)
    })

    test.each`
      amount                         | code     | message                   | error
      ${startingBalance + BigInt(1)} | ${'403'} | ${'Insufficient balance'} | ${LiquidityError.InsufficientBalance}
      ${BigInt(0)}                   | ${'400'} | ${'Amount is zero'}       | ${LiquidityError.AmountZero}
    `(
      'Returns error for $error',
      async ({ amount, code, message, error }): Promise<void> => {
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation CreateAssetLiquidityWithdrawal(
                $input: CreateAssetLiquidityWithdrawalInput!
              ) {
                createAssetLiquidityWithdrawal(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: {
                id: uuid(),
                assetId,
                amount: amount.toString()
              }
            }
          })
          .then(
            (query): LiquidityMutationResponse => {
              if (query.data) {
                return query.data.createAssetLiquidityWithdrawal
              } else {
                throw new Error('Data was empty')
              }
            }
          )

        expect(response.success).toBe(false)
        expect(response.code).toEqual(code)
        expect(response.message).toEqual(message)
        expect(response.error).toEqual(error)
      }
    )
  })

  describe('Create account withdrawal', (): void => {
    let accountId: string
    const amount = BigInt(100)

    beforeEach(
      async (): Promise<void> => {
        const accountService = await deps.use('accountService')
        accountId = (
          await accountService.create({
            asset: randomAsset()
          })
        ).id

        await expect(
          accountingService.createDeposit({
            id: uuid(),
            accountId,
            amount
          })
        ).resolves.toBeUndefined()
      }
    )

    test('Can create withdrawal from account', async (): Promise<void> => {
      const id = uuid()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAccountWithdrawal(
              $input: CreateAccountWithdrawalInput!
            ) {
              createAccountWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                  amount
                  account {
                    id
                  }
                }
              }
            }
          `,
          variables: {
            input: {
              id,
              accountId
            }
          }
        })
        .then(
          (query): AccountWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createAccountWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
      expect(response.error).toBeNull()
      expect(response.withdrawal).toMatchObject({
        id,
        amount: amount.toString(),
        account: {
          id: accountId
        }
      })
    })

    test('Returns an error for unknown account', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAccountWithdrawal(
              $input: CreateAccountWithdrawalInput!
            ) {
              createAccountWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              accountId: uuid()
            }
          }
        })
        .then(
          (query): AccountWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createAccountWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown account')
      expect(response.error).toEqual(LiquidityError.UnknownAccount)
      expect(response.withdrawal).toBeNull()
    })

    test('Returns an error for invalid id', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAccountWithdrawal(
              $input: CreateAccountWithdrawalInput!
            ) {
              createAccountWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id: 'not a uuid',
              accountId
            }
          }
        })
        .then(
          (query): AccountWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createAccountWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid id')
      expect(response.error).toEqual(LiquidityError.InvalidId)
      expect(response.withdrawal).toBeNull()
    })

    test('Returns an error for existing transfer', async (): Promise<void> => {
      const id = uuid()
      await expect(
        accountingService.createDeposit({
          id,
          accountId,
          amount: BigInt(10)
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAccountWithdrawal(
              $input: CreateAccountWithdrawalInput!
            ) {
              createAccountWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id,
              accountId
            }
          }
        })
        .then(
          (query): AccountWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createAccountWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(response.success).toBe(false)
      expect(response.code).toEqual('409')
      expect(response.message).toEqual('Transfer exists')
      expect(response.error).toEqual(LiquidityError.TransferExists)
      expect(response.withdrawal).toBeNull()
    })

    test('Returns an error for empty balance', async (): Promise<void> => {
      await expect(
        accountingService.createWithdrawal({
          id: uuid(),
          accountId,
          amount,
          timeout
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAccountWithdrawal(
              $input: CreateAccountWithdrawalInput!
            ) {
              createAccountWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              accountId
            }
          }
        })
        .then(
          (query): AccountWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createAccountWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Amount is zero')
      expect(response.error).toEqual(LiquidityError.AmountZero)
      expect(response.withdrawal).toBeNull()
    })
  })

  describe('Create invoice withdrawal', (): void => {
    let invoiceId: string
    const amount = BigInt(100)

    beforeEach(
      async (): Promise<void> => {
        const { id: accountId } = await accountService.create({
          asset: randomAsset()
        })
        invoiceId = (
          await invoiceService.create({
            accountId,
            amount,
            expiresAt: new Date(Date.now() + 30_000)
          })
        ).id

        await expect(
          accountingService.createDeposit({
            id: uuid(),
            accountId: invoiceId,
            amount
          })
        ).resolves.toBeUndefined()
      }
    )

    test('Can create withdrawal from invoice', async (): Promise<void> => {
      const id = uuid()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateInvoiceWithdrawal(
              $input: CreateInvoiceWithdrawalInput!
            ) {
              createInvoiceWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                  amount
                  invoice {
                    id
                  }
                }
              }
            }
          `,
          variables: {
            input: {
              id,
              invoiceId
            }
          }
        })
        .then(
          (query): InvoiceWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createInvoiceWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
      expect(response.error).toBeNull()
      expect(response.withdrawal).toMatchObject({
        id,
        amount: amount.toString(),
        invoice: {
          id: invoiceId
        }
      })
    })

    test('Returns an error for unknown invoice', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateInvoiceWithdrawal(
              $input: CreateInvoiceWithdrawalInput!
            ) {
              createInvoiceWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              invoiceId: uuid()
            }
          }
        })
        .then(
          (query): InvoiceWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createInvoiceWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown invoice')
      expect(response.error).toEqual(LiquidityError.UnknownInvoice)
      expect(response.withdrawal).toBeNull()
    })

    test('Returns an error for invalid id', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateInvoiceWithdrawal(
              $input: CreateInvoiceWithdrawalInput!
            ) {
              createInvoiceWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id: 'not a uuid',
              invoiceId
            }
          }
        })
        .then(
          (query): InvoiceWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createInvoiceWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid id')
      expect(response.error).toEqual(LiquidityError.InvalidId)
      expect(response.withdrawal).toBeNull()
    })

    test('Returns an error for existing transfer', async (): Promise<void> => {
      const id = uuid()
      await expect(
        accountingService.createDeposit({
          id,
          accountId: invoiceId,
          amount: BigInt(10)
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateInvoiceWithdrawal(
              $input: CreateInvoiceWithdrawalInput!
            ) {
              createInvoiceWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id,
              invoiceId
            }
          }
        })
        .then(
          (query): InvoiceWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createInvoiceWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(response.success).toBe(false)
      expect(response.code).toEqual('409')
      expect(response.message).toEqual('Transfer exists')
      expect(response.error).toEqual(LiquidityError.TransferExists)
      expect(response.withdrawal).toBeNull()
    })

    test('Returns an error for empty balance', async (): Promise<void> => {
      await expect(
        accountingService.createWithdrawal({
          id: uuid(),
          accountId: invoiceId,
          amount,
          timeout
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateInvoiceWithdrawal(
              $input: CreateInvoiceWithdrawalInput!
            ) {
              createInvoiceWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              invoiceId
            }
          }
        })
        .then(
          (query): InvoiceWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createInvoiceWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Amount is zero')
      expect(response.error).toEqual(LiquidityError.AmountZero)
      expect(response.withdrawal).toBeNull()
    })
  })

  describe('Create outgoing payment withdrawal', (): void => {
    let paymentId: string
    const startingBalance = BigInt(100)

    beforeEach(
      async (): Promise<void> => {
        paymentId = (await paymentFactory.build()).id

        await expect(
          accountingService.createDeposit({
            id: uuid(),
            accountId: paymentId,
            amount: startingBalance
          })
        ).resolves.toBeUndefined()
      }
    )

    afterEach((): void => {
      jest.restoreAllMocks()
    })

    test('Can create withdrawal from outgoing payment', async (): Promise<void> => {
      const id = uuid()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateOutgoingPaymentWithdrawal(
              $input: CreateOutgoingPaymentWithdrawalInput!
            ) {
              createOutgoingPaymentWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                  amount
                  payment {
                    id
                  }
                }
              }
            }
          `,
          variables: {
            input: {
              id,
              paymentId
            }
          }
        })
        .then(
          (query): OutgoingPaymentWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createOutgoingPaymentWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
      expect(response.error).toBeNull()
      expect(response.withdrawal).toMatchObject({
        id,
        amount: startingBalance.toString(),
        payment: {
          id: paymentId
        }
      })
    })

    test('Returns an error for unknown outgoing payment', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateOutgoingPaymentWithdrawal(
              $input: CreateOutgoingPaymentWithdrawalInput!
            ) {
              createOutgoingPaymentWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              paymentId: uuid()
            }
          }
        })
        .then(
          (query): OutgoingPaymentWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createOutgoingPaymentWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown outgoing payment')
      expect(response.error).toEqual(LiquidityError.UnknownPayment)
      expect(response.withdrawal).toBeNull()
    })

    test('Returns an error for invalid id', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateOutgoingPaymentWithdrawal(
              $input: CreateOutgoingPaymentWithdrawalInput!
            ) {
              createOutgoingPaymentWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id: 'not a uuid',
              paymentId
            }
          }
        })
        .then(
          (query): OutgoingPaymentWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createOutgoingPaymentWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid id')
      expect(response.error).toEqual(LiquidityError.InvalidId)
      expect(response.withdrawal).toBeNull()
    })

    test('Returns an error for existing transfer', async (): Promise<void> => {
      const id = uuid()
      await expect(
        accountingService.createDeposit({
          id,
          accountId: paymentId,
          amount: BigInt(10)
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateOutgoingPaymentWithdrawal(
              $input: CreateOutgoingPaymentWithdrawalInput!
            ) {
              createOutgoingPaymentWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id,
              paymentId
            }
          }
        })
        .then(
          (query): OutgoingPaymentWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createOutgoingPaymentWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(response.success).toBe(false)
      expect(response.code).toEqual('409')
      expect(response.message).toEqual('Transfer exists')
      expect(response.error).toEqual(LiquidityError.TransferExists)
      expect(response.withdrawal).toBeNull()
    })

    test('Returns an error for empty balance', async (): Promise<void> => {
      await expect(
        accountingService.createWithdrawal({
          id: uuid(),
          accountId: paymentId,
          amount: startingBalance,
          timeout
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateOutgoingPaymentWithdrawal(
              $input: CreateOutgoingPaymentWithdrawalInput!
            ) {
              createOutgoingPaymentWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              paymentId
            }
          }
        })
        .then(
          (query): OutgoingPaymentWithdrawalMutationResponse => {
            if (query.data) {
              return query.data.createOutgoingPaymentWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Amount is zero')
      expect(response.error).toEqual(LiquidityError.AmountZero)
      expect(response.withdrawal).toBeNull()
    })
  })

  enum AccountType {
    Asset = 'Asset',
    Invoice = 'Invoice',
    Payment = 'Payment',
    Peer = 'Peer'
  }

  describe('Finalize/Rollback liquidity withdrawal', (): void => {
    describe.each(Object.values(AccountType).map((type) => [type]))(
      '%s',
      (type): void => {
        let withdrawalId: string

        beforeEach(
          async (): Promise<void> => {
            let deposit: Deposit
            const amount = BigInt(100)
            if (type === AccountType.Asset) {
              const unit = randomUnit()
              await accountingService.createAssetAccounts(unit)
              deposit = {
                id: uuid(),
                asset: { unit },
                amount
              }
            } else {
              let accountId: string
              if (type === AccountType.Invoice) {
                const account = await accountService.create({
                  asset: randomAsset()
                })
                const invoice = await invoiceService.create({
                  accountId: account.id,
                  amount,
                  expiresAt: new Date(Date.now() + 30_000)
                })
                accountId = invoice.id
              } else if (type === AccountType.Payment) {
                const payment = await paymentFactory.build()
                accountId = payment.id
              } else {
                assert.equal(type, AccountType.Peer)
                const peer = await peerFactory.build()
                accountId = peer.id
              }
              deposit = {
                id: uuid(),
                accountId,
                amount
              }
            }

            await expect(
              accountingService.createDeposit(deposit)
            ).resolves.toBeUndefined()
            withdrawalId = uuid()
            await expect(
              accountingService.createWithdrawal({
                ...deposit,
                id: withdrawalId,
                amount: BigInt(10),
                timeout
              })
            ).resolves.toBeUndefined()
          }
        )

        test(`Can finalize a liquidity withdrawal`, async (): Promise<void> => {
          const response = await appContainer.apolloClient
            .mutate({
              mutation: gql`
                mutation FinalizeLiquidityWithdrawal($withdrawalId: String!) {
                  finalizeLiquidityWithdrawal(withdrawalId: $withdrawalId) {
                    code
                    success
                    message
                    error
                  }
                }
              `,
              variables: {
                withdrawalId
              }
            })
            .then(
              (query): LiquidityMutationResponse => {
                if (query.data) {
                  return query.data.finalizeLiquidityWithdrawal
                } else {
                  throw new Error('Data was empty')
                }
              }
            )

          expect(response.success).toBe(true)
          expect(response.code).toEqual('200')
          expect(response.error).toBeNull()
        })

        test("Can't finalize finalized withdrawal", async (): Promise<void> => {
          await expect(
            accountingService.commitWithdrawal(withdrawalId)
          ).resolves.toBeUndefined()
          const response = await appContainer.apolloClient
            .mutate({
              mutation: gql`
                mutation FinalizeLiquidityWithdrawal($withdrawalId: String!) {
                  finalizeLiquidityWithdrawal(withdrawalId: $withdrawalId) {
                    code
                    success
                    message
                    error
                  }
                }
              `,
              variables: {
                withdrawalId
              }
            })
            .then(
              (query): LiquidityMutationResponse => {
                if (query.data) {
                  return query.data.finalizeLiquidityWithdrawal
                } else {
                  throw new Error('Data was empty')
                }
              }
            )

          expect(response.success).toBe(false)
          expect(response.code).toEqual('409')
          expect(response.message).toEqual('Withdrawal already finalized')
          expect(response.error).toEqual(LiquidityError.AlreadyCommitted)
        })

        test("Can't finalize rolled back withdrawal", async (): Promise<void> => {
          await expect(
            accountingService.rollbackWithdrawal(withdrawalId)
          ).resolves.toBeUndefined()
          const response = await appContainer.apolloClient
            .mutate({
              mutation: gql`
                mutation FinalizeLiquidityWithdrawal($withdrawalId: String!) {
                  finalizeLiquidityWithdrawal(withdrawalId: $withdrawalId) {
                    code
                    success
                    message
                    error
                  }
                }
              `,
              variables: {
                withdrawalId
              }
            })
            .then(
              (query): LiquidityMutationResponse => {
                if (query.data) {
                  return query.data.finalizeLiquidityWithdrawal
                } else {
                  throw new Error('Data was empty')
                }
              }
            )

          expect(response.success).toBe(false)
          expect(response.code).toEqual('409')
          expect(response.message).toEqual('Withdrawal already rolled back')
          expect(response.error).toEqual(LiquidityError.AlreadyRolledBack)
        })

        test(`Can rollback a liquidity withdrawal`, async (): Promise<void> => {
          const response = await appContainer.apolloClient
            .mutate({
              mutation: gql`
                mutation RollbackLiquidityWithdrawal($withdrawalId: String!) {
                  rollbackLiquidityWithdrawal(withdrawalId: $withdrawalId) {
                    code
                    success
                    message
                    error
                  }
                }
              `,
              variables: {
                withdrawalId
              }
            })
            .then(
              (query): LiquidityMutationResponse => {
                if (query.data) {
                  return query.data.rollbackLiquidityWithdrawal
                } else {
                  throw new Error('Data was empty')
                }
              }
            )

          expect(response.success).toBe(true)
          expect(response.code).toEqual('200')
          expect(response.error).toBeNull()
        })

        test("Can't rollback finalized withdrawal", async (): Promise<void> => {
          await expect(
            accountingService.commitWithdrawal(withdrawalId)
          ).resolves.toBeUndefined()
          const response = await appContainer.apolloClient
            .mutate({
              mutation: gql`
                mutation RollbackLiquidityWithdrawal($withdrawalId: String!) {
                  rollbackLiquidityWithdrawal(withdrawalId: $withdrawalId) {
                    code
                    success
                    message
                    error
                  }
                }
              `,
              variables: {
                withdrawalId
              }
            })
            .then(
              (query): LiquidityMutationResponse => {
                if (query.data) {
                  return query.data.rollbackLiquidityWithdrawal
                } else {
                  throw new Error('Data was empty')
                }
              }
            )

          expect(response.success).toBe(false)
          expect(response.code).toEqual('409')
          expect(response.message).toEqual('Withdrawal already finalized')
          expect(response.error).toEqual(LiquidityError.AlreadyCommitted)
        })

        test("Can't rollback rolled back withdrawal", async (): Promise<void> => {
          await expect(
            accountingService.rollbackWithdrawal(withdrawalId)
          ).resolves.toBeUndefined()
          const response = await appContainer.apolloClient
            .mutate({
              mutation: gql`
                mutation RollbackLiquidityWithdrawal($withdrawalId: String!) {
                  rollbackLiquidityWithdrawal(withdrawalId: $withdrawalId) {
                    code
                    success
                    message
                    error
                  }
                }
              `,
              variables: {
                withdrawalId
              }
            })
            .then(
              (query): LiquidityMutationResponse => {
                if (query.data) {
                  return query.data.rollbackLiquidityWithdrawal
                } else {
                  throw new Error('Data was empty')
                }
              }
            )

          expect(response.success).toBe(false)
          expect(response.code).toEqual('409')
          expect(response.message).toEqual('Withdrawal already rolled back')
          expect(response.error).toEqual(LiquidityError.AlreadyRolledBack)
        })
      }
    )

    test("Can't finalize non-existent withdrawal", async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation FinalizeLiquidityWithdrawal($withdrawalId: String!) {
              finalizeLiquidityWithdrawal(withdrawalId: $withdrawalId) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            withdrawalId: uuid()
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.finalizeLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown withdrawal')
      expect(response.error).toEqual(LiquidityError.UnknownTransfer)
    })

    test("Can't finalize invalid withdrawal id", async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation FinalizeLiquidityWithdrawal($withdrawalId: String!) {
              finalizeLiquidityWithdrawal(withdrawalId: $withdrawalId) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            withdrawalId: 'not a uuid'
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.finalizeLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid id')
      expect(response.error).toEqual(LiquidityError.InvalidId)
    })

    test("Can't rollback non-existent withdrawal", async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation RollbackLiquidityWithdrawal($withdrawalId: String!) {
              rollbackLiquidityWithdrawal(withdrawalId: $withdrawalId) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            withdrawalId: uuid()
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.rollbackLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown withdrawal')
      expect(response.error).toEqual(LiquidityError.UnknownTransfer)
    })

    test("Can't rollback invalid withdrawal id", async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation RollbackLiquidityWithdrawal($withdrawalId: String!) {
              rollbackLiquidityWithdrawal(withdrawalId: $withdrawalId) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            withdrawalId: 'not a uuid'
          }
        })
        .then(
          (query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.rollbackLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid id')
      expect(response.error).toEqual(LiquidityError.InvalidId)
    })
  })
})
