import { Model } from 'objection'
import { Transaction } from 'knex'
import { v4 as uuid } from 'uuid'

import { AccountFactory } from '../../accounts/testsHelpers'
import { TransferInput, TransferMutationResponse } from '../generated/graphql'
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
  })
})
