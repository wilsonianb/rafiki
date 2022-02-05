import { gql } from 'apollo-server-koa'
import { Knex } from 'knex'
import { v4 as uuid } from 'uuid'
import * as Pay from '@interledger/pay'

import { createTestApp, TestContainer } from '../../tests/app'
import { IocContract } from '@adonisjs/fold'
import { AppServices } from '../../app'
import { initIocContainer } from '../..'
import { Config } from '../../config/app'
import { AccountingService, LiquidityAccount } from '../../accounting/service'
import { Asset } from '../../asset/model'
import { AssetService } from '../../asset/service'
import { Account } from '../../open_payments/account/model'
import { Invoice } from '../../open_payments/invoice/model'
import { OutgoingPayment, PaymentState } from '../../outgoing_payment/model'
import { Peer } from '../../peer/model'
import { randomAsset } from '../../tests/asset'
import { PeerFactory } from '../../tests/peerFactory'
import { truncateTables } from '../../tests/tableManager'
import { DepositEventType, WithdrawEventType } from '../../webhook/model'
import { EventOptions, isPaymentEventType } from '../../webhook/service'
import {
  LiquidityError,
  LiquidityMutationResponse,
  AccountWithdrawalMutationResponse
} from '../generated/graphql'

describe('Liquidity Resolvers', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let accountingService: AccountingService
  let assetService: AssetService
  let peerFactory: PeerFactory
  let knex: Knex
  const timeout = BigInt(10e9) // 10 seconds

  beforeAll(
    async (): Promise<void> => {
      deps = await initIocContainer(Config)
      appContainer = await createTestApp(deps)
      knex = await deps.use('knex')
      accountingService = await deps.use('accountingService')
      assetService = await deps.use('assetService')
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
    let peer: Peer

    beforeEach(
      async (): Promise<void> => {
        peer = await peerFactory.build()
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
              peerId: peer.id,
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
              peerId: peer.id,
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
          account: peer,
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
              peerId: peer.id,
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
              peerId: peer.id,
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
    let asset: Asset

    beforeEach(
      async (): Promise<void> => {
        asset = await assetService.getOrCreate(randomAsset())
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
              assetId: asset.id,
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
              assetId: asset.id,
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
          account: asset,
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
              assetId: asset.id,
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
              assetId: asset.id,
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
    let peer: Peer
    const startingBalance = BigInt(100)

    beforeEach(
      async (): Promise<void> => {
        peer = await peerFactory.build()
        await expect(
          accountingService.createDeposit({
            id: uuid(),
            account: peer,
            amount: startingBalance
          })
        ).resolves.toBeUndefined()
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
              peerId: peer.id,
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
              peerId: peer.id,
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
          account: peer,
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
              peerId: peer.id,
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
                peerId: peer.id,
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
    let asset: Asset
    const startingBalance = BigInt(100)

    beforeEach(
      async (): Promise<void> => {
        asset = await assetService.getOrCreate(randomAsset())
        await expect(
          accountingService.createDeposit({
            id: uuid(),
            account: asset,
            amount: startingBalance
          })
        ).resolves.toBeUndefined()
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
              assetId: asset.id,
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
              assetId: asset.id,
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
          account: asset,
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
              assetId: asset.id,
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
                assetId: asset.id,
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
    let account: Account
    const amount = BigInt(100)

    beforeEach(
      async (): Promise<void> => {
        const accountService = await deps.use('accountService')
        account = await accountService.create({
          asset: randomAsset()
        })

        await expect(
          accountingService.createDeposit({
            id: uuid(),
            account,
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
              accountId: account.id
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
          id: account.id
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
              accountId: account.id
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
          account,
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
              accountId: account.id
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
          account,
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
              accountId: account.id
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

  describe.each(['peer', 'asset'])(
    'Finalize %s liquidity withdrawal',
    (type): void => {
      let withdrawalId: string

      beforeEach(
        async (): Promise<void> => {
          const peer = await peerFactory.build()
          const deposit = {
            id: uuid(),
            account: type === 'peer' ? peer : peer.asset,
            amount: BigInt(100)
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

      test(`Can finalize a(n) ${type} liquidity withdrawal`, async (): Promise<void> => {
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
    }
  )

  describe.each(['peer', 'asset'])(
    'Roll back %s liquidity withdrawal',
    (type): void => {
      let withdrawalId: string

      beforeEach(
        async (): Promise<void> => {
          const peer = await peerFactory.build()
          const deposit = {
            id: uuid(),
            account: type === 'peer' ? peer : peer.asset,
            amount: BigInt(100)
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

      test(`Can rollback a(n) ${type} liquidity withdrawal`, async (): Promise<void> => {
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

  {
    let invoice: Invoice
    let payment: OutgoingPayment

    beforeEach(
      async (): Promise<void> => {
        const accountService = await deps.use('accountService')
        const { id: accountId } = await accountService.create({
          asset: randomAsset()
        })
        const invoiceService = await deps.use('invoiceService')
        invoice = await invoiceService.create({
          accountId,
          amount: BigInt(56),
          expiresAt: new Date(Date.now() + 60 * 1000),
          description: 'description!'
        })
        const outgoingPaymentService = await deps.use('outgoingPaymentService')
        const config = await deps.use('config')
        const invoiceUrl = `${config.publicHost}/invoices/${invoice.id}`
        // create and then patch quote
        payment = await outgoingPaymentService.create({
          accountId,
          invoiceUrl,
          autoApprove: false
        })
        await payment.$query(knex).patch({
          state: PaymentState.Funding,
          quote: {
            timestamp: new Date(),
            activationDeadline: new Date(Date.now() + 1000),
            targetType: Pay.PaymentType.FixedSend,
            minDeliveryAmount: BigInt(123),
            maxSourceAmount: BigInt(456),
            maxPacketAmount: BigInt(789),
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            minExchangeRate: Pay.Ratio.from(1.23)!,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            lowExchangeRateEstimate: Pay.Ratio.from(1.2)!,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            highExchangeRateEstimate: Pay.Ratio.from(2.3)!,
            amountSent: BigInt(0)
          }
        })
      }
    )

    describe('depositLiquidity', (): void => {
      describe.each(Object.values(DepositEventType).map((type) => [type]))(
        '%s',
        (type): void => {
          let id: string

          beforeEach(
            async (): Promise<void> => {
              id = uuid()
              const webhookService = await deps.use('webhookService')
              await webhookService.createEvent({
                id,
                type,
                payment,
                amountSent: BigInt(0),
                balance: BigInt(0)
              })
            }
          )

          test('Can deposit account liquidity', async (): Promise<void> => {
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation DepositLiquidity($id: String!) {
                    depositLiquidity(id: $id) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  id
                }
              })
              .then(
                (query): LiquidityMutationResponse => {
                  if (query.data) {
                    return query.data.depositLiquidity
                  } else {
                    throw new Error('Data was empty')
                  }
                }
              )

            expect(response.success).toBe(true)
            expect(response.code).toEqual('200')
            expect(response.error).toBeNull()
          })

          test("Can't deposit for non-existent webhook id", async (): Promise<void> => {
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation DepositLiquidity($id: String!) {
                    depositLiquidity(id: $id) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  id: uuid()
                }
              })
              .then(
                (query): LiquidityMutationResponse => {
                  if (query.data) {
                    return query.data.depositLiquidity
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
            await expect(
              accountingService.createDeposit({
                id,
                account: invoice,
                amount: BigInt(100)
              })
            ).resolves.toBeUndefined()
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation DepositLiquidity($id: String!) {
                    depositLiquidity(id: $id) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  id
                }
              })
              .then(
                (query): LiquidityMutationResponse => {
                  if (query.data) {
                    return query.data.depositLiquidity
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
        }
      )
    })

    describe('withdrawLiquidity', (): void => {
      describe.each(Object.values(WithdrawEventType).map((type) => [type]))(
        '%s',
        (type): void => {
          let id: string

          beforeEach(
            async (): Promise<void> => {
              const webhookService = await deps.use('webhookService')

              id = uuid()
              const amount = BigInt(10)
              let account: LiquidityAccount
              let options: EventOptions
              if (isPaymentEventType(type)) {
                account = payment
                options = {
                  id,
                  type,
                  payment,
                  amountSent: BigInt(0),
                  balance: amount
                }
              } else {
                account = invoice
                options = {
                  id,
                  type,
                  invoice,
                  amountReceived: amount
                }
              }
              await expect(
                accountingService.createDeposit({
                  id: uuid(),
                  account,
                  amount
                })
              ).resolves.toBeUndefined()
              await expect(
                accountingService.createWithdrawal({
                  id,
                  account,
                  amount,
                  timeout
                })
              ).resolves.toBeUndefined()
              await expect(
                accountingService.getBalance(account.id)
              ).resolves.toEqual(BigInt(0))
              await webhookService.createEvent(options)
            }
          )

          test('Can withdraw account liquidity', async (): Promise<void> => {
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation WithdrawLiquidity($id: String!) {
                    withdrawLiquidity(id: $id) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  id
                }
              })
              .then(
                (query): LiquidityMutationResponse => {
                  if (query.data) {
                    return query.data.withdrawLiquidity
                  } else {
                    throw new Error('Data was empty')
                  }
                }
              )

            expect(response.success).toBe(true)
            expect(response.code).toEqual('200')
            expect(response.error).toBeNull()
          })

          test('Returns error for non-existent webhook id', async (): Promise<void> => {
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation WithdrawLiquidity($id: String!) {
                    withdrawLiquidity(id: $id) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  id: uuid()
                }
              })
              .then(
                (query): LiquidityMutationResponse => {
                  if (query.data) {
                    return query.data.withdrawLiquidity
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

          test('Returns error for finalized withdrawal', async (): Promise<void> => {
            await expect(
              accountingService.commitWithdrawal(id)
            ).resolves.toBeUndefined()
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation WithdrawLiquidity($id: String!) {
                    withdrawLiquidity(id: $id) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  id
                }
              })
              .then(
                (query): LiquidityMutationResponse => {
                  if (query.data) {
                    return query.data.withdrawLiquidity
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

          test('Returns error for rolled back withdrawal', async (): Promise<void> => {
            await expect(
              accountingService.rollbackWithdrawal(id)
            ).resolves.toBeUndefined()
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation WithdrawLiquidity($id: String!) {
                    withdrawLiquidity(id: $id) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  id
                }
              })
              .then(
                (query): LiquidityMutationResponse => {
                  if (query.data) {
                    return query.data.withdrawLiquidity
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
    })
  }
})
