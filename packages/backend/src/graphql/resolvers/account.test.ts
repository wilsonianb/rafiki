import { gql } from 'apollo-server-koa'
import { Transaction } from 'knex'
import { Model } from 'objection'

import { createTestApp, TestContainer } from '../../tests/app'
import { IocContract } from '@adonisjs/fold'
import { AppServices } from '../../app'
import { initIocContainer } from '../..'
import { Config } from '../../config/app'
import { AccountService } from '../../account/service'
import { Account as AccountModel } from '../../account/model'
import { AccountFactory } from '../../tests/accountFactory'
import { Account } from '../generated/graphql'

describe('Account Resolvers', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let trx: Transaction

  beforeAll(
    async (): Promise<void> => {
      deps = await initIocContainer(Config)
      appContainer = await createTestApp(deps)
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
      await appContainer.apolloClient.stop()
      await appContainer.shutdown()
    }
  )

  describe('Account', (): void => {
    let accountService: AccountService
    let accountFactory: AccountFactory
    let account: AccountModel

    beforeEach(
      async (): Promise<void> => {
        accountService = await deps.use('accountService')
        accountFactory = new AccountFactory(accountService)
        account = await accountFactory.build({
          asset: {
            scale: 6,
            code: 'USD'
          }
        })
      }
    )

    test('Can get a account', async (): Promise<void> => {
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Account($accountId: String!) {
              account(id: $accountId) {
                id
                balance {
                  amount
                  scale
                  currency
                }
              }
            }
          `,
          variables: {
            accountId: account.id
          }
        })
        .then(
          (query): Account => {
            if (query.data) {
              return query.data.account
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(query.id).toEqual(account.id)
      expect(query.balance.amount).toEqual(300)
      expect(query.balance.currency).toEqual('USD')
      expect(query.balance.scale).toEqual(6)
    })
  })
})
