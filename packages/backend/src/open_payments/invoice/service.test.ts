import assert from 'assert'
import Knex from 'knex'
import { WorkerUtils, makeWorkerUtils } from 'graphile-worker'
import nock from 'nock'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'

import { InvoiceService } from './service'
import { AccountingService } from '../../accounting/service'
import { createTestApp, TestContainer } from '../../tests/app'
import { Invoice } from './model'
import { resetGraphileDb } from '../../tests/graphileDb'
import { GraphileProducer } from '../../messaging/graphileProducer'
import { Config } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { randomAsset } from '../../tests/asset'
import { truncateTables } from '../../tests/tableManager'
import { EventType } from '../../webhook/service'

describe('Invoice Service', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let workerUtils: WorkerUtils
  let invoiceService: InvoiceService
  let knex: Knex
  let accountId: string
  let accountingService: AccountingService
  const messageProducer = new GraphileProducer()
  const mockMessageProducer = {
    send: jest.fn()
  }
  const webhookUrl = new URL(Config.webhookUrl)

  function mockWebhookServer(
    invoiceId: string,
    type: EventType,
    status = 200
  ): nock.Scope {
    return nock(webhookUrl.origin)
      .post(webhookUrl.pathname, (body): boolean => {
        expect(body.type).toEqual(type)
        expect(body.data.invoice.id).toEqual(invoiceId)
        expect(body.data.invoice.active).toEqual(false)
        return true
      })
      .reply(status)
  }

  beforeAll(
    async (): Promise<void> => {
      deps = await initIocContainer(Config)
      deps.bind('messageProducer', async () => mockMessageProducer)
      appContainer = await createTestApp(deps)
      workerUtils = await makeWorkerUtils({
        connectionString: appContainer.connectionUrl
      })
      accountingService = await deps.use('accountingService')
      await workerUtils.migrate()
      messageProducer.setUtils(workerUtils)
      knex = await deps.use('knex')
    }
  )

  beforeEach(
    async (): Promise<void> => {
      invoiceService = await deps.use('invoiceService')
      const accountService = await deps.use('accountService')
      accountId = (await accountService.create({ asset: randomAsset() })).id
    }
  )

  afterEach(
    async (): Promise<void> => {
      jest.useRealTimers()
      await truncateTables(knex)
    }
  )

  afterAll(
    async (): Promise<void> => {
      await resetGraphileDb(knex)
      await appContainer.shutdown()
      await workerUtils.release()
    }
  )

  describe('Create/Get Invoice', (): void => {
    test('An invoice can be created and fetched', async (): Promise<void> => {
      const invoice = await invoiceService.create({
        accountId,
        amount: BigInt(123),
        expiresAt: new Date(Date.now() + 30_000),
        description: 'Test invoice'
      })
      const accountService = await deps.use('accountService')
      expect(invoice).toMatchObject({
        id: invoice.id,
        account: await accountService.get(accountId),
        processAt: new Date(invoice.expiresAt.getTime() + 30_000)
      })
      const retrievedInvoice = await invoiceService.get(invoice.id)
      if (!retrievedInvoice) throw new Error('invoice not found')
      expect(retrievedInvoice).toEqual(invoice)
    })

    test('Creating an invoice creates a liquidity account', async (): Promise<void> => {
      const invoice = await invoiceService.create({
        accountId,
        description: 'Invoice',
        expiresAt: new Date(Date.now() + 30_000),
        amount: BigInt(123)
      })
      await expect(accountingService.getAccount(invoice.id)).resolves.toEqual({
        id: invoice.id,
        asset: {
          unit: invoice.account.asset.unit
        },
        balance: BigInt(0)
      })
    })

    test('Cannot create invoice for nonexistent account', async (): Promise<void> => {
      await expect(
        invoiceService.create({
          accountId: uuid(),
          amount: BigInt(123),
          expiresAt: new Date(Date.now() + 30_000),
          description: 'Test invoice'
        })
      ).rejects.toThrow('unable to create invoice, account does not exist')
    })

    test('Cannot fetch a bogus invoice', async (): Promise<void> => {
      await expect(invoiceService.get(uuid())).resolves.toBeUndefined()
    })
  })

  describe('handlePayment', (): void => {
    let invoice: Invoice

    beforeEach(
      async (): Promise<void> => {
        invoice = await invoiceService.create({
          accountId,
          description: 'Test invoice',
          amount: BigInt(123),
          expiresAt: new Date(Date.now() + 30_000)
        })
      }
    )

    test('Does not deactivate a partially paid invoice', async (): Promise<void> => {
      await expect(
        accountingService.createDeposit({
          id: uuid(),
          accountId: invoice.id,
          amount: invoice.amount - BigInt(1)
        })
      ).resolves.toBeUndefined()

      await invoice.handlePayment(accountingService)
      await expect(invoice.active).toEqual(true)
      await expect(invoiceService.get(invoice.id)).resolves.toEqual(invoice)
    })

    test('Deactivates fully paid invoice', async (): Promise<void> => {
      await expect(
        accountingService.createDeposit({
          id: uuid(),
          accountId: invoice.id,
          amount: invoice.amount
        })
      ).resolves.toBeUndefined()

      const now = new Date()
      jest.useFakeTimers('modern')
      jest.setSystemTime(now)
      await invoice.handlePayment(accountingService)
      await expect(invoice).toMatchObject({
        active: false,
        processAt: now
      })
      await expect(invoiceService.get(invoice.id)).resolves.toEqual(invoice)
    })
  })

  describe('processNext', (): void => {
    test('Does not process not-expired active invoice', async (): Promise<void> => {
      const { id: invoiceId } = await invoiceService.create({
        accountId,
        amount: BigInt(123),
        description: 'Test invoice',
        expiresAt: new Date(Date.now() + 30_000)
      })
      await expect(invoiceService.processNext()).resolves.toBeUndefined()
      await expect(invoiceService.get(invoiceId)).resolves.toMatchObject({
        active: true
      })
    })

    describe('handleExpired', (): void => {
      test('Deactivates an expired invoice with received money', async (): Promise<void> => {
        const invoice = await invoiceService.create({
          accountId,
          amount: BigInt(123),
          description: 'Test invoice',
          expiresAt: new Date(Date.now() - 40_000)
        })
        await expect(
          accountingService.createDeposit({
            id: uuid(),
            accountId: invoice.id,
            amount: BigInt(1)
          })
        ).resolves.toBeUndefined()

        const now = new Date()
        jest.useFakeTimers('modern')
        jest.setSystemTime(now)
        await expect(invoiceService.processNext()).resolves.toBe(invoice.id)
        await expect(invoiceService.get(invoice.id)).resolves.toMatchObject({
          active: false,
          processAt: now
        })
      })

      test('Deletes an expired invoice (and account) with no money', async (): Promise<void> => {
        const invoice = await invoiceService.create({
          accountId,
          amount: BigInt(123),
          description: 'Test invoice',
          expiresAt: new Date(Date.now() - 40_000)
        })
        await expect(invoiceService.processNext()).resolves.toBe(invoice.id)
        expect(await invoiceService.get(invoice.id)).toBeUndefined()
      })
    })

    describe.each`
      event                       | expiresAt  | amountReceived
      ${EventType.InvoiceExpired} | ${-40_000} | ${BigInt(1)}
      ${EventType.InvoicePaid}    | ${30_000}  | ${BigInt(123)}
    `(
      'handleDeactivated ($event)',
      ({ event, expiresAt, amountReceived }): void => {
        let invoice: Invoice

        beforeEach(
          async (): Promise<void> => {
            invoice = await invoiceService.create({
              accountId,
              amount: BigInt(123),
              expiresAt: new Date(Date.now() + expiresAt),
              description: 'Test invoice'
            })
            await expect(
              accountingService.createDeposit({
                id: uuid(),
                accountId: invoice.id,
                amount: amountReceived
              })
            ).resolves.toBeUndefined()
            if (event === EventType.InvoiceExpired) {
              await expect(invoiceService.processNext()).resolves.toBe(
                invoice.id
              )
            } else {
              await invoice.handlePayment(accountingService)
            }
            invoice = (await invoiceService.get(invoice.id)) as Invoice
            expect(invoice.active).toBe(false)
            expect(invoice.processAt).not.toBeNull()
            await expect(
              accountingService.getTotalReceived(invoice.id)
            ).resolves.toEqual(amountReceived)
            await expect(
              accountingService.getBalance(invoice.id)
            ).resolves.toEqual(amountReceived)
          }
        )

        test('Withdraws invoice liquidity', async (): Promise<void> => {
          const scope = mockWebhookServer(invoice.id, event)
          await expect(invoiceService.processNext()).resolves.toBe(invoice.id)
          expect(scope.isDone()).toBe(true)
          await expect(invoiceService.get(invoice.id)).resolves.toMatchObject({
            processAt: null,
            webhookAttempts: 0
          })
          await expect(
            accountingService.getBalance(invoice.id)
          ).resolves.toEqual(BigInt(0))
        })

        test("Doesn't withdraw on webhook error", async (): Promise<void> => {
          assert.ok(invoice.processAt)
          const scope = mockWebhookServer(invoice.id, event, 504)
          await expect(invoiceService.processNext()).resolves.toBe(invoice.id)
          expect(scope.isDone()).toBe(true)
          await expect(invoiceService.get(invoice.id)).resolves.toMatchObject({
            processAt: new Date(invoice.processAt.getTime() + 10_000),
            webhookAttempts: 1
          })
          await expect(
            accountingService.getBalance(invoice.id)
          ).resolves.toEqual(amountReceived)
        })

        test("Doesn't withdraw on webhook timeout", async (): Promise<void> => {
          assert.ok(invoice.processAt)
          const scope = nock(webhookUrl.origin)
            .post(webhookUrl.pathname)
            .delayConnection(Config.webhookTimeout + 1)
            .reply(200)
          await expect(invoiceService.processNext()).resolves.toBe(invoice.id)
          expect(scope.isDone()).toBe(true)
          await expect(invoiceService.get(invoice.id)).resolves.toMatchObject({
            processAt: new Date(invoice.processAt.getTime() + 10_000),
            webhookAttempts: 1
          })
          await expect(
            accountingService.getBalance(invoice.id)
          ).resolves.toEqual(amountReceived)
        })
      }
    )
  })

  describe('Invoice pagination', (): void => {
    let invoicesCreated: Invoice[]

    beforeEach(
      async (): Promise<void> => {
        invoicesCreated = []
        for (let i = 0; i < 40; i++) {
          invoicesCreated.push(
            await invoiceService.create({
              accountId,
              amount: BigInt(123),
              expiresAt: new Date(Date.now() + 30_000),
              description: `Invoice ${i}`
            })
          )
        }
      }
    )

    test('Defaults to fetching first 20 items', async (): Promise<void> => {
      const invoices = await invoiceService.getAccountInvoicesPage(accountId)
      expect(invoices).toHaveLength(20)
      expect(invoices[0].id).toEqual(invoicesCreated[0].id)
      expect(invoices[19].id).toEqual(invoicesCreated[19].id)
      expect(invoices[20]).toBeUndefined()
    })

    test('Can change forward pagination limit', async (): Promise<void> => {
      const pagination = {
        first: 10
      }
      const invoices = await invoiceService.getAccountInvoicesPage(
        accountId,
        pagination
      )
      expect(invoices).toHaveLength(10)
      expect(invoices[0].id).toEqual(invoicesCreated[0].id)
      expect(invoices[9].id).toEqual(invoicesCreated[9].id)
      expect(invoices[10]).toBeUndefined()
    })

    test('Can paginate forwards from a cursor', async (): Promise<void> => {
      const pagination = {
        after: invoicesCreated[19].id
      }
      const invoices = await invoiceService.getAccountInvoicesPage(
        accountId,
        pagination
      )
      expect(invoices).toHaveLength(20)
      expect(invoices[0].id).toEqual(invoicesCreated[20].id)
      expect(invoices[19].id).toEqual(invoicesCreated[39].id)
      expect(invoices[20]).toBeUndefined()
    })

    test('Can paginate forwards from a cursor with a limit', async (): Promise<void> => {
      const pagination = {
        first: 10,
        after: invoicesCreated[9].id
      }
      const invoices = await invoiceService.getAccountInvoicesPage(
        accountId,
        pagination
      )
      expect(invoices).toHaveLength(10)
      expect(invoices[0].id).toEqual(invoicesCreated[10].id)
      expect(invoices[9].id).toEqual(invoicesCreated[19].id)
      expect(invoices[10]).toBeUndefined()
    })

    test("Can't change backward pagination limit on it's own.", async (): Promise<void> => {
      const pagination = {
        last: 10
      }
      const invoices = invoiceService.getAccountInvoicesPage(
        accountId,
        pagination
      )
      await expect(invoices).rejects.toThrow(
        "Can't paginate backwards from the start."
      )
    })

    test('Can paginate backwards from a cursor', async (): Promise<void> => {
      const pagination = {
        before: invoicesCreated[20].id
      }
      const invoices = await invoiceService.getAccountInvoicesPage(
        accountId,
        pagination
      )
      expect(invoices).toHaveLength(20)
      expect(invoices[0].id).toEqual(invoicesCreated[0].id)
      expect(invoices[19].id).toEqual(invoicesCreated[19].id)
      expect(invoices[20]).toBeUndefined()
    })

    test('Can paginate backwards from a cursor with a limit', async (): Promise<void> => {
      const pagination = {
        last: 5,
        before: invoicesCreated[10].id
      }
      const invoices = await invoiceService.getAccountInvoicesPage(
        accountId,
        pagination
      )
      expect(invoices).toHaveLength(5)
      expect(invoices[0].id).toEqual(invoicesCreated[5].id)
      expect(invoices[4].id).toEqual(invoicesCreated[9].id)
      expect(invoices[5]).toBeUndefined()
    })

    test('Backwards/Forwards pagination results in same order.', async (): Promise<void> => {
      const paginationForwards = {
        first: 10
      }
      const invoicesForwards = await invoiceService.getAccountInvoicesPage(
        accountId,
        paginationForwards
      )
      const paginationBackwards = {
        last: 10,
        before: invoicesCreated[10].id
      }
      const invoicesBackwards = await invoiceService.getAccountInvoicesPage(
        accountId,
        paginationBackwards
      )
      expect(invoicesForwards).toHaveLength(10)
      expect(invoicesBackwards).toHaveLength(10)
      expect(invoicesForwards).toEqual(invoicesBackwards)
    })

    test('Providing before and after results in forward pagination', async (): Promise<void> => {
      const pagination = {
        after: invoicesCreated[19].id,
        before: invoicesCreated[19].id
      }
      const invoices = await invoiceService.getAccountInvoicesPage(
        accountId,
        pagination
      )
      expect(invoices).toHaveLength(20)
      expect(invoices[0].id).toEqual(invoicesCreated[20].id)
      expect(invoices[19].id).toEqual(invoicesCreated[39].id)
      expect(invoices[20]).toBeUndefined()
    })

    test("Can't request less than 0 invoices", async (): Promise<void> => {
      const pagination = {
        first: -1
      }
      const invoices = invoiceService.getAccountInvoicesPage(
        accountId,
        pagination
      )
      await expect(invoices).rejects.toThrow('Pagination index error')
    })

    test("Can't request more than 100 invoices", async (): Promise<void> => {
      const pagination = {
        first: 101
      }
      const invoices = invoiceService.getAccountInvoicesPage(
        accountId,
        pagination
      )
      await expect(invoices).rejects.toThrow('Pagination index error')
    })
  })
})
