import assert from 'assert'
import nock, { Definition } from 'nock'
import { URL } from 'url'
import Knex from 'knex'
import { v4 as uuid } from 'uuid'

import {
  DepositOptions,
  DepositType,
  InvoiceWithdrawalType,
  WithdrawalOptions,
  WithdrawalType,
  LiquidityService,
  generateWebhookSignature
} from './service'
import { createTestApp, TestContainer } from '../tests/app'
import { randomAsset } from '../tests/asset'
import { truncateTables } from '../tests/tableManager'
import { Config } from '../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../'
import { AppServices } from '../app'
import { TransferError } from '../accounting/errors'
import { AccountingService } from '../accounting/service'
import { Invoice } from '../open_payments/invoice/model'
import { OutgoingPayment } from '../outgoing_payment/model'

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
const isDepositType = (type: any): type is DepositType =>
  Object.values(DepositType).includes(type)

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
const isInvoiceType = (type: any): type is InvoiceWithdrawalType =>
  Object.values(InvoiceWithdrawalType).includes(type)

describe('Liquidity Service', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let liquidityService: LiquidityService
  let knex: Knex
  let accountingService: AccountingService
  let invoice: Invoice
  let payment: OutgoingPayment
  let webhookUrl: URL
  let id: string
  let startingBalance: bigint
  const WEBHOOK_SECRET = 'test secret'

  beforeAll(
    async (): Promise<void> => {
      Config.webhookSecret = WEBHOOK_SECRET
      deps = await initIocContainer(Config)
      appContainer = await createTestApp(deps)
      knex = await deps.use('knex')
      liquidityService = await deps.use('liquidityService')
      webhookUrl = new URL(Config.webhookUrl)
      accountingService = await deps.use('accountingService')
    }
  )

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
      payment = await outgoingPaymentService.create({
        accountId,
        invoiceUrl,
        autoApprove: false
      })
      payment.amountSent = BigInt(0)
    }
  )

  afterAll(
    async (): Promise<void> => {
      await appContainer.shutdown()
      await truncateTables(knex)
    }
  )

  function mockWebhookServer(
    options: DepositOptions | WithdrawalOptions,
    status = 200
  ): nock.Scope {
    return nock(webhookUrl.origin)
      .post(webhookUrl.pathname, function (this: Definition, body) {
        assert.ok(this.headers)
        const signature = this.headers['rafiki-signature']
        expect(
          generateWebhookSignature(
            body,
            WEBHOOK_SECRET,
            Config.signatureVersion
          )
        ).toEqual(signature)
        expect(body.id).toEqual(options.id)
        expect(body.type).toEqual(options.type)
        if (isInvoiceType(options.type)) {
          expect(body.data).toEqual({
            invoice: invoice.toBody()
          })
        } else {
          expect(body.data).toEqual({
            payment: payment.toBody()
          })
        }
        return true
      })
      .reply(status, async (uri, requestBody, cb) => {
        if (!isDepositType(options.type)) {
          // Withdrawal amount is reserved
          await expect(accountingService.getBalance(id)).resolves.toEqual(
            startingBalance - options.amount
          )
        }
        cb(null, '')
      })
  }

  describe('deposit', function () {
    describe.each(Object.values(DepositType).map((type) => [type]))(
      '%s',
      (type): void => {
        let options: DepositOptions
        const amount = BigInt(5)

        beforeEach(
          async (): Promise<void> => {
            startingBalance = BigInt(0)
            id = payment.id
            payment.balance = startingBalance
            options = {
              id: uuid(),
              type,
              payment,
              amount
            }
            await expect(accountingService.getBalance(id)).resolves.toEqual(
              startingBalance
            )
          }
        )

        test('deposits on successful webhook response', async (): Promise<void> => {
          const scope = mockWebhookServer(options)
          await liquidityService.deposit(options)
          expect(scope.isDone()).toBe(true)
          await expect(accountingService.getBalance(id)).resolves.toEqual(
            startingBalance + amount
          )
        })

        test('throws for failed request', async (): Promise<void> => {
          const scope = mockWebhookServer(options, 500)
          await expect(liquidityService.deposit(options)).rejects.toThrowError(
            'Request failed with status code 500'
          )
          expect(scope.isDone()).toBe(true)
          await expect(accountingService.getBalance(id)).resolves.toEqual(
            startingBalance
          )
        })
      }
    )
  })

  describe('withdraw', function () {
    describe.each(Object.values(WithdrawalType).map((type) => [type]))(
      '%s',
      (type): void => {
        let options: WithdrawalOptions
        const amount = BigInt(5)

        beforeEach(
          async (): Promise<void> => {
            startingBalance = BigInt(10)
            if (isInvoiceType(type)) {
              id = invoice.id
              invoice.received = startingBalance
              options = {
                id: invoice.id,
                type,
                invoice,
                amount
              }
            } else {
              id = payment.id
              payment.balance = startingBalance
              options = {
                id: uuid(),
                type,
                payment,
                amount
              }
            }
            await expect(
              accountingService.createDeposit({
                id: uuid(),
                accountId: id,
                amount: startingBalance
              })
            ).resolves.toBeUndefined()
            await expect(accountingService.getBalance(id)).resolves.toEqual(
              startingBalance
            )
          }
        )

        test('withdraws balance on successful webhook response', async (): Promise<void> => {
          const scope = mockWebhookServer(options)
          await liquidityService.withdraw(options)
          expect(scope.isDone()).toBe(true)
          await expect(accountingService.getBalance(id)).resolves.toEqual(
            startingBalance - amount
          )
        })

        test('throws for failed request', async (): Promise<void> => {
          const scope = mockWebhookServer(options, 500)
          await expect(liquidityService.withdraw(options)).rejects.toThrowError(
            'Request failed with status code 500'
          )
          expect(scope.isDone()).toBe(true)
          await expect(accountingService.getBalance(id)).resolves.toEqual(
            startingBalance
          )
        })

        test('throws for insufficient balance', async (): Promise<void> => {
          options.amount = startingBalance + BigInt(1)
          await expect(liquidityService.withdraw(options)).rejects.toThrowError(
            TransferError.InsufficientBalance
          )
          // ).resolves.toEqual(TransferError.InsufficientBalance)
          await expect(accountingService.getBalance(id)).resolves.toEqual(
            startingBalance
          )
        })

        // test("Doesn't withdraw on webhook timeout", async (): Promise<void> => {
        //   assert.ok(invoice.processAt)
        //   const scope = nock(webhookUrl.origin)
        //     .post(webhookUrl.pathname)
        //     .delayConnection(Config.webhookTimeout + 1)
        //     .reply(200)
        //   await expect(invoiceService.processNext()).resolves.toBe(invoice.id)
        //   expect(scope.isDone()).toBe(true)
        //   await expect(invoiceService.get(invoice.id)).resolves.toMatchObject({
        //     processAt: new Date(invoice.processAt.getTime() + 10_000),
        //     withdrawalAttempts: 1
        //   })
        //   await expect(
        //     accountingService.getBalance(invoice.id)
        //   ).resolves.toEqual(amountReceived)
        // })
      }
    )
  })
})
