import { Model } from 'objection'
import Knex, { Transaction } from 'knex'
import { createClient, Client } from 'tigerbeetle-node'
import { v4 as uuid } from 'uuid'

import { AccountFactory } from '../../accounts/testsHelpers'
import { AccountsService } from '../../accounts/service'
import {
  CreateDepositInput,
  CreateDepositMutationResponse
} from '../generated/graphql'
import { Logger } from '../../logger/service'
import { createKnex } from '../../Knex/service'
import { ApolloServer, gql } from 'apollo-server'

import { Config } from '../../config'
import { apolloClient as apolloClientTest } from '../testsHelpers/apolloClient'
import { ApolloClient, NormalizedCacheObject } from '@apollo/client'
import { createAdminApi } from '../index'

const ADMIN_API_HOST = process.env.ADMIN_API_HOST || '127.0.0.1'
const ADMIN_API_PORT = parseInt(process.env.ADMIN_API_PORT || '3001', 10)

describe('Deposit Resolvers', (): void => {
  let accountsService: AccountsService
  let accountFactory: AccountFactory
  let config: typeof Config
  let tbClient: Client
  let adminApi: ApolloServer
  let apolloClient: ApolloClient<NormalizedCacheObject>
  let knex: Knex
  let trx: Transaction

  beforeAll(
    async (): Promise<void> => {
      config = Config
      config.ilpAddress = 'test.rafiki'
      config.peerAddresses = [
        {
          accountId: uuid(),
          ilpAddress: 'test.alice'
        }
      ]
      tbClient = createClient({
        cluster_id: config.tigerbeetleClusterId,
        replica_addresses: config.tigerbeetleReplicaAddresses
      })
      knex = await createKnex(config.postgresUrl)
      accountsService = new AccountsService(tbClient, config, Logger)
      accountFactory = new AccountFactory(accountsService)
      apolloClient = apolloClientTest
      adminApi = await createAdminApi({ accountsService })
      await adminApi.listen({ host: ADMIN_API_HOST, port: ADMIN_API_PORT })
    }
  )

  beforeEach(
    async (): Promise<void> => {
      trx = await knex.transaction()
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
      await adminApi.stop()
      await knex.destroy()
      tbClient.destroy()
    }
  )

  describe('Create Deposit', (): void => {
    test('Can create an ilp account deposit', async (): Promise<void> => {
      const { id: ilpAccountId } = await accountFactory.build()
      const amount = '100'
      const deposit: CreateDepositInput = {
        ilpAccountId,
        amount
      }
      const response = await apolloClient
        .mutate({
          mutation: gql`
            mutation CreateDeposit($input: CreateDepositInput!) {
              createDeposit(input: $input) {
                code
                success
                message
                deposit {
                  id
                  ilpAccountId
                  amount
                }
              }
            }
          `,
          variables: {
            input: deposit
          }
        })
        .then(
          (query): CreateDepositMutationResponse => {
            if (query.data) {
              return query.data.createDeposit
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
      expect(response.deposit?.id).not.toBeNull()
      expect(response.deposit?.ilpAccountId).toEqual(ilpAccountId)
      expect(response.deposit?.amount).toEqual(amount)
    })
  })
})
