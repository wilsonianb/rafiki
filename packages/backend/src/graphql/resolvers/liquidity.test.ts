import assert from 'assert'
import { gql } from 'apollo-server-koa'
import Knex from 'knex'
import { v4 as uuid } from 'uuid'

import { createTestApp, TestContainer } from '../../tests/app'
import { IocContract } from '@adonisjs/fold'
import { AppServices } from '../../app'
import { initIocContainer } from '../..'
import { Config } from '../../config/app'
import {
  AccountingService,
  LiquidityAccount,
  Withdrawal
} from '../../accounting/service'
import { Asset } from '../../asset/model'
import { AssetService } from '../../asset/service'
import {
  Account,
  WebMonetizationEventType
} from '../../open_payments/account/model'
import {
  IncomingPayment,
  IncomingPaymentEventType,
  isIncomingPaymentEventType
} from '../../open_payments/payment/incoming/model'
import {
  OutgoingPayment,
  OutgoingPaymentEvent,
  OutgoingPaymentEventType,
  isOutgoingPaymentEventType
} from '../../open_payments/payment/outgoing/model'
import { Peer } from '../../peer/model'
import { randomAsset } from '../../tests/asset'
import { createIncomingPayment } from '../../tests/incomingPayment'
import { createOutgoingPayment } from '../../tests/outgoingPayment'
import { PeerFactory } from '../../tests/peerFactory'
import { truncateTables } from '../../tests/tableManager'
import { WebhookEvent } from '../../webhook/model'
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
  const timeout = BigInt(10_000) // 10 seconds

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
    let account: Account
    let incomingPayment: IncomingPayment
    let payment: OutgoingPayment

    beforeEach(
      async (): Promise<void> => {
        const accountService = await deps.use('accountService')
        account = await accountService.create({
          asset: randomAsset()
        })
        const accountId = account.id
        incomingPayment = await createIncomingPayment(deps, {
          accountId,
          incomingAmount: {
            value: BigInt(56),
            assetCode: account.asset.code,
            assetScale: account.asset.scale
          },
          expiresAt: new Date(Date.now() + 60 * 1000),
          description: 'description!'
        })
        payment = await createOutgoingPayment(deps, {
          accountId,
          receiver: `${
            Config.publicHost
          }/${uuid()}/incoming-payments/${uuid()}`,
          sendAmount: {
            value: BigInt(456),
            assetCode: account.asset.code,
            assetScale: account.asset.scale
          },
          validDestination: false
        })
        await expect(accountingService.getBalance(payment.id)).resolves.toEqual(
          BigInt(0)
        )
      }
    )

    describe('depositEventLiquidity', (): void => {
      describe.each([OutgoingPaymentEventType.OutgoingPaymentCreated])(
        '%s',
        (type): void => {
          let eventId: string

          beforeEach(
            async (): Promise<void> => {
              eventId = uuid()
              await OutgoingPaymentEvent.query(knex).insertAndFetch({
                id: eventId,
                type,
                data: payment.toData()
              })
            }
          )

          test('Can deposit account liquidity', async (): Promise<void> => {
            const depositSpy = jest.spyOn(accountingService, 'createDeposit')
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation DepositLiquidity($eventId: String!) {
                    depositEventLiquidity(eventId: $eventId) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  eventId
                }
              })
              .then(
                (query): LiquidityMutationResponse => {
                  if (query.data) {
                    return query.data.depositEventLiquidity
                  } else {
                    throw new Error('Data was empty')
                  }
                }
              )

            expect(response.success).toBe(true)
            expect(response.code).toEqual('200')
            expect(response.error).toBeNull()
            assert.ok(payment.sendAmount)
            await expect(depositSpy).toHaveBeenCalledWith({
              id: eventId,
              account: expect.any(OutgoingPayment),
              amount: payment.sendAmount.value
            })
            await expect(
              accountingService.getBalance(payment.id)
            ).resolves.toEqual(payment.sendAmount.value)
          })

          test("Can't deposit for non-existent webhook event id", async (): Promise<void> => {
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation DepositLiquidity($eventId: String!) {
                    depositEventLiquidity(eventId: $eventId) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  eventId: uuid()
                }
              })
              .then(
                (query): LiquidityMutationResponse => {
                  if (query.data) {
                    return query.data.depositEventLiquidity
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
                id: eventId,
                account: incomingPayment,
                amount: BigInt(100)
              })
            ).resolves.toBeUndefined()
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation DepositLiquidity($eventId: String!) {
                    depositEventLiquidity(eventId: $eventId) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  eventId
                }
              })
              .then(
                (query): LiquidityMutationResponse => {
                  if (query.data) {
                    return query.data.depositEventLiquidity
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

    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      OutgoingPaymentCreated,
      ...OutgoingPaymentWithdrawType
    } = OutgoingPaymentEventType
    type OutgoingPaymentWithdrawType = Exclude<
      OutgoingPaymentEventType,
      OutgoingPaymentEventType.OutgoingPaymentCreated
    >
    const WithdrawEventType = {
      ...WebMonetizationEventType,
      ...IncomingPaymentEventType,
      ...OutgoingPaymentWithdrawType
    }
    type WithdrawEventType =
      | WebMonetizationEventType
      | IncomingPaymentEventType
      | OutgoingPaymentWithdrawType

    describe('withdrawEventLiquidity', (): void => {
      describe.each(Object.values(WithdrawEventType).map((type) => [type]))(
        '%s',
        (type): void => {
          let eventId: string
          let withdrawal: Withdrawal

          beforeEach(
            async (): Promise<void> => {
              eventId = uuid()
              const amount = BigInt(10)
              let liquidityAccount: LiquidityAccount
              let data: Record<string, unknown>
              if (isOutgoingPaymentEventType(type)) {
                liquidityAccount = payment
                data = payment.toData()
              } else if (isIncomingPaymentEventType(type)) {
                liquidityAccount = incomingPayment
                incomingPayment.receivedAmount = {
                  value: amount,
                  assetCode: incomingPayment.asset.code,
                  assetScale: incomingPayment.asset.scale
                }
                data = incomingPayment.toData()
              } else {
                liquidityAccount = account
                data = {
                  webMonetization: {
                    accountId: account.id,
                    amount: {
                      value: amount,
                      assetCode: account.asset.code,
                      assetScale: account.asset.scale
                    }
                  }
                }
              }
              await WebhookEvent.query(knex).insertAndFetch({
                id: eventId,
                type,
                data,
                withdrawal: {
                  accountId: liquidityAccount.id,
                  assetId: liquidityAccount.asset.id,
                  amount
                }
              })
              await expect(
                accountingService.createDeposit({
                  id: uuid(),
                  account: liquidityAccount,
                  amount
                })
              ).resolves.toBeUndefined()
              await expect(
                accountingService.getBalance(liquidityAccount.id)
              ).resolves.toEqual(amount)
              withdrawal = {
                id: eventId,
                account: liquidityAccount,
                amount
              }
            }
          )

          test('Can withdraw account liquidity', async (): Promise<void> => {
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation WithdrawLiquidity($eventId: String!) {
                    withdrawEventLiquidity(eventId: $eventId) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  eventId
                }
              })
              .then(
                (query): LiquidityMutationResponse => {
                  if (query.data) {
                    return query.data.withdrawEventLiquidity
                  } else {
                    throw new Error('Data was empty')
                  }
                }
              )

            expect(response.success).toBe(true)
            expect(response.code).toEqual('200')
            expect(response.error).toBeNull()
          })

          test('Returns error for non-existent webhook event id', async (): Promise<void> => {
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation WithdrawLiquidity($eventId: String!) {
                    withdrawEventLiquidity(eventId: $eventId) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  eventId: uuid()
                }
              })
              .then(
                (query): LiquidityMutationResponse => {
                  if (query.data) {
                    return query.data.withdrawEventLiquidity
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

          test('Returns error for already completed withdrawal', async (): Promise<void> => {
            await expect(
              accountingService.createWithdrawal(withdrawal)
            ).resolves.toBeUndefined()
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation WithdrawLiquidity($eventId: String!) {
                    withdrawEventLiquidity(eventId: $eventId) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  eventId
                }
              })
              .then(
                (query): LiquidityMutationResponse => {
                  if (query.data) {
                    return query.data.withdrawEventLiquidity
                  } else {
                    throw new Error('Data was empty')
                  }
                }
              )

            expect(response.success).toBe(false)
            expect(response.code).toEqual('403')
            expect(response.message).toEqual('Insufficient balance')
            expect(response.error).toEqual(LiquidityError.InsufficientBalance)
          })
        }
      )
    })
  }
})
