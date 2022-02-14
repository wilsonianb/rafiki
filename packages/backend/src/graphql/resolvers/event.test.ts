import { gql } from 'apollo-server-koa'
import Knex from 'knex'

import { createTestApp, TestContainer } from '../../tests/app'
import { IocContract } from '@adonisjs/fold'
import { AppServices } from '../../app'
import { initIocContainer } from '../..'
import { Config } from '../../config/app'
import { truncateTables } from '../../tests/tableManager'
import { AccountService } from '../../open_payments/account/service'
import { Invoice, InvoiceEventType } from '../../open_payments/invoice/model'
import { InvoiceService } from '../../open_payments/invoice/service'
import { randomAsset } from '../../tests/asset'
import { EventsConnection } from '../generated/graphql'

describe('Event Resolvers', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let knex: Knex
  let accountService: AccountService
  let invoiceService: InvoiceService

  beforeAll(
    async (): Promise<void> => {
      deps = await initIocContainer(Config)
      appContainer = await createTestApp(deps)
      knex = await deps.use('knex')
      accountService = await deps.use('accountService')
      invoiceService = await deps.use('invoiceService')
    }
  )

  afterAll(
    async (): Promise<void> => {
      await truncateTables(knex)
      await appContainer.apolloClient.stop()
      await appContainer.shutdown()
    }
  )

  describe('Events Queries', (): void => {
    const events: Invoice[] = []

    beforeAll(
      async (): Promise<void> => {
        const asset = randomAsset()
        for (let i = 0; i < 50; i++) {
          const { id: accountId } = await accountService.create({ asset })
          const invoice = await invoiceService.create({
            accountId,
            amount: BigInt(123),
            expiresAt: new Date(Date.now() + 30_000),
            description: `Invoice ${i}`
          })
          await invoice.$query(knex).patch({
            event: InvoiceEventType.InvoicePaid
          })
          events.push(invoice)
        }
      }
    )

    test('Can get events', async (): Promise<void> => {
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Events {
              events {
                edges {
                  node {
                    ... on Invoice {
                      id
                      amount
                    }
                  }
                  cursor
                }
              }
            }
          `
        })
        .then(
          (query): EventsConnection => {
            if (query.data) {
              return query.data.events
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(query.edges).toHaveLength(20)
      query.edges.forEach((edge, idx) => {
        const event = events[idx]
        expect(edge.cursor).toEqual(event.id)
        expect(edge.node).toEqual({
          __typename: 'Invoice',
          id: event.id,
          amount: event.amount.toString()
        })
      })
    })

    test('pageInfo is correct on default query without params', async (): Promise<void> => {
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Events {
              events {
                edges {
                  node {
                    ... on Invoice {
                      id
                    }
                  }
                  cursor
                }
                pageInfo {
                  endCursor
                  hasNextPage
                  hasPreviousPage
                  startCursor
                }
              }
            }
          `
        })
        .then(
          (query): EventsConnection => {
            if (query.data) {
              return query.data.events
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(query.edges).toHaveLength(20)
      expect(query.pageInfo.hasNextPage).toBeTruthy()
      expect(query.pageInfo.hasPreviousPage).toBeFalsy()
      expect(query.pageInfo.startCursor).toEqual(events[0].id)
      expect(query.pageInfo.endCursor).toEqual(events[19].id)
    }, 10_000)

    test('pageInfo is correct on pagination from start', async (): Promise<void> => {
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Events {
              events(first: 10) {
                edges {
                  node {
                    ... on Invoice {
                      id
                    }
                  }
                  cursor
                }
                pageInfo {
                  endCursor
                  hasNextPage
                  hasPreviousPage
                  startCursor
                }
              }
            }
          `
        })
        .then(
          (query): EventsConnection => {
            if (query.data) {
              return query.data.events
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(query.edges).toHaveLength(10)
      expect(query.pageInfo.hasNextPage).toBeTruthy()
      expect(query.pageInfo.hasPreviousPage).toBeFalsy()
      expect(query.pageInfo.startCursor).toEqual(events[0].id)
      expect(query.pageInfo.endCursor).toEqual(events[9].id)
    }, 10_000)

    test('pageInfo is correct on pagination from middle', async (): Promise<void> => {
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Events($after: String!) {
              events(after: $after) {
                edges {
                  node {
                    ... on Invoice {
                      id
                    }
                  }
                  cursor
                }
                pageInfo {
                  endCursor
                  hasNextPage
                  hasPreviousPage
                  startCursor
                }
              }
            }
          `,
          variables: {
            after: events[19].id
          }
        })
        .then(
          (query): EventsConnection => {
            if (query.data) {
              return query.data.events
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(query.edges).toHaveLength(20)
      expect(query.pageInfo.hasNextPage).toBeTruthy()
      expect(query.pageInfo.hasPreviousPage).toBeTruthy()
      expect(query.pageInfo.startCursor).toEqual(events[20].id)
      expect(query.pageInfo.endCursor).toEqual(events[39].id)
    }, 10_000)

    test('pageInfo is correct on pagination near end', async (): Promise<void> => {
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Events($after: String!) {
              events(after: $after, first: 10) {
                edges {
                  node {
                    ... on Invoice {
                      id
                    }
                  }
                  cursor
                }
                pageInfo {
                  endCursor
                  hasNextPage
                  hasPreviousPage
                  startCursor
                }
              }
            }
          `,
          variables: {
            after: events[44].id
          }
        })
        .then(
          (query): EventsConnection => {
            if (query.data) {
              return query.data.events
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(query.edges).toHaveLength(5)
      expect(query.pageInfo.hasNextPage).toBeFalsy()
      expect(query.pageInfo.hasPreviousPage).toBeTruthy()
      expect(query.pageInfo.startCursor).toEqual(events[45].id)
      expect(query.pageInfo.endCursor).toEqual(events[49].id)
    }, 10_000)

    test('No events, but events requested', async (): Promise<void> => {
      await truncateTables(knex)
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Events {
              events {
                edges {
                  node {
                    ... on Invoice {
                      id
                    }
                  }
                  cursor
                }
                pageInfo {
                  endCursor
                  hasNextPage
                  hasPreviousPage
                  startCursor
                }
              }
            }
          `
        })
        .then(
          (query): EventsConnection => {
            if (query.data) {
              return query.data.events
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(query.edges).toHaveLength(0)
      expect(query.pageInfo.hasNextPage).toBeFalsy()
      expect(query.pageInfo.hasPreviousPage).toBeFalsy()
      expect(query.pageInfo.startCursor).toBeNull()
      expect(query.pageInfo.endCursor).toBeNull()
    })
  })
})
