import { gql } from 'apollo-server-koa'
import Knex from 'knex'

import { createTestApp, TestContainer } from '../../tests/app'
import { IocContract } from '@adonisjs/fold'
import { AppServices } from '../../app'
import { initIocContainer } from '../..'
import { Config } from '../../config/app'
import { randomAsset } from '../../tests/asset'
import { truncateTables } from '../../tests/tableManager'
import { Invoice } from '../../invoice/model'
import { InvoiceService } from '../../invoice/service'
import { PaymentPointerService } from '../../payment_pointer/service'
import { PaymentPointer } from '../generated/graphql'

describe('Invoice Resolver', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let invoiceService: InvoiceService
  let paymentPointerService: PaymentPointerService
  let knex: Knex
  let invoices: Invoice[]
  let paymentPointerId: string

  beforeAll(async (): Promise<void> => {
    deps = await initIocContainer(Config)
    appContainer = await createTestApp(deps)
    knex = await deps.use('knex')
    invoiceService = await deps.use('invoiceService')
    paymentPointerService = await deps.use('paymentPointerService')
    paymentPointerId = (
      await paymentPointerService.create({ asset: randomAsset() })
    ).id
    invoices = []
    for (let i = 0; i < 50; i++) {
      invoices.push(
        await invoiceService.create(paymentPointerId, `Invoice ${i}`)
      )
    }
  }, 10_000)

  afterAll(
    async (): Promise<void> => {
      await truncateTables(knex)
      await appContainer.apolloClient.stop()
      await appContainer.shutdown()
    }
  )

  describe('Payment pointer invoices', (): void => {
    test('pageInfo is correct on default query without params', async (): Promise<void> => {
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query PaymentPointer($id: String!) {
              paymentPointer(id: $id) {
                invoices {
                  edges {
                    node {
                      id
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
            }
          `,
          variables: {
            id: paymentPointerId
          }
        })
        .then(
          (query): PaymentPointer => {
            if (query.data) {
              return query.data.paymentPointer
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(query.invoices?.edges).toHaveLength(20)
      expect(query.invoices?.pageInfo.hasNextPage).toBeTruthy()
      expect(query.invoices?.pageInfo.hasPreviousPage).toBeFalsy()
      expect(query.invoices?.pageInfo.startCursor).toEqual(invoices[0].id)
      expect(query.invoices?.pageInfo.endCursor).toEqual(invoices[19].id)
    })

    test('No invoices, but invoices requested', async (): Promise<void> => {
      const paymentPointer = await paymentPointerService.create({
        asset: randomAsset()
      })
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query PaymentPointer($id: String!) {
              paymentPointer(id: $id) {
                invoices {
                  edges {
                    node {
                      id
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
            }
          `,
          variables: {
            id: paymentPointer.id
          }
        })
        .then(
          (query): PaymentPointer => {
            if (query.data) {
              return query.data.paymentPointer
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(query.invoices?.edges).toHaveLength(0)
      expect(query.invoices?.pageInfo.hasNextPage).toBeFalsy()
      expect(query.invoices?.pageInfo.hasPreviousPage).toBeFalsy()
      expect(query.invoices?.pageInfo.startCursor).toBeNull()
      expect(query.invoices?.pageInfo.endCursor).toBeNull()
    })

    test('pageInfo is correct on pagination from start', async (): Promise<void> => {
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query PaymentPointer($id: String!) {
              paymentPointer(id: $id) {
                invoices(first: 10) {
                  edges {
                    node {
                      id
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
            }
          `,
          variables: {
            id: paymentPointerId
          }
        })
        .then(
          (query): PaymentPointer => {
            if (query.data) {
              return query.data.paymentPointer
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(query.invoices?.edges).toHaveLength(10)
      expect(query.invoices?.pageInfo.hasNextPage).toBeTruthy()
      expect(query.invoices?.pageInfo.hasPreviousPage).toBeFalsy()
      expect(query.invoices?.pageInfo.startCursor).toEqual(invoices[0].id)
      expect(query.invoices?.pageInfo.endCursor).toEqual(invoices[9].id)
    })

    test('pageInfo is correct on pagination from middle', async (): Promise<void> => {
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query PaymentPointer($id: String!, $after: String!) {
              paymentPointer(id: $id) {
                invoices(after: $after) {
                  edges {
                    node {
                      id
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
            }
          `,
          variables: {
            id: paymentPointerId,
            after: invoices[19].id
          }
        })
        .then(
          (query): PaymentPointer => {
            if (query.data) {
              return query.data.paymentPointer
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(query.invoices?.edges).toHaveLength(20)
      expect(query.invoices?.pageInfo.hasNextPage).toBeTruthy()
      expect(query.invoices?.pageInfo.hasPreviousPage).toBeTruthy()
      expect(query.invoices?.pageInfo.startCursor).toEqual(invoices[20].id)
      expect(query.invoices?.pageInfo.endCursor).toEqual(invoices[39].id)
    })

    test('pageInfo is correct on pagination near end', async (): Promise<void> => {
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query PaymentPointer($id: String!, $after: String!) {
              paymentPointer(id: $id) {
                invoices(after: $after, first: 10) {
                  edges {
                    node {
                      id
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
            }
          `,
          variables: {
            id: paymentPointerId,
            after: invoices[44].id
          }
        })
        .then(
          (query): PaymentPointer => {
            if (query.data) {
              return query.data.paymentPointer
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(query.invoices?.edges).toHaveLength(5)
      expect(query.invoices?.pageInfo.hasNextPage).toBeFalsy()
      expect(query.invoices?.pageInfo.hasPreviousPage).toBeTruthy()
      expect(query.invoices?.pageInfo.startCursor).toEqual(invoices[45].id)
      expect(query.invoices?.pageInfo.endCursor).toEqual(invoices[49].id)
    })
  })
})
