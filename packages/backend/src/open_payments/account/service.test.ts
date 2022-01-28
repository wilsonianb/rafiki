import assert from 'assert'
import Knex from 'knex'
import { WorkerUtils, makeWorkerUtils } from 'graphile-worker'
import nock from 'nock'
import { v4 as uuid } from 'uuid'

import { Account } from './model'
import { AccountService } from './service'
import { AccountingService } from '../../accounting/service'
import { createTestApp, TestContainer } from '../../tests/app'
import { randomAsset } from '../../tests/asset'
import { resetGraphileDb } from '../../tests/graphileDb'
import { truncateTables } from '../../tests/tableManager'
import { GraphileProducer } from '../../messaging/graphileProducer'
import { Config } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { EventType } from '../../webhook/service'

describe('Open Payments Account Service', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let workerUtils: WorkerUtils
  let accountService: AccountService
  let accountingService: AccountingService
  let knex: Knex
  const messageProducer = new GraphileProducer()
  const mockMessageProducer = {
    send: jest.fn()
  }
  const webhookUrl = new URL(Config.webhookUrl)

  beforeAll(
    async (): Promise<void> => {
      deps = await initIocContainer(Config)
      deps.bind('messageProducer', async () => mockMessageProducer)
      appContainer = await createTestApp(deps)
      workerUtils = await makeWorkerUtils({
        connectionString: appContainer.connectionUrl
      })
      await workerUtils.migrate()
      messageProducer.setUtils(workerUtils)
      knex = await deps.use('knex')
      accountService = await deps.use('accountService')
      accountingService = await deps.use('accountingService')
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

  describe('Create or Get Account', (): void => {
    test('Account can be created or fetched', async (): Promise<void> => {
      const options = {
        asset: randomAsset()
      }
      const account = await accountService.create(options)
      await expect(account).toMatchObject(options)
      await expect(accountService.get(account.id)).resolves.toEqual(account)
    })

    test('Creating an account creates an SPSP fallback account', async (): Promise<void> => {
      const account = await accountService.create({ asset: randomAsset() })

      const accountingService = await deps.use('accountingService')
      await expect(accountingService.getAccount(account.id)).resolves.toEqual({
        id: account.id,
        asset: {
          unit: account.asset.unit
        },
        balance: BigInt(0)
      })
    })
  })

  describe('handlePayment', (): void => {
    let account: Account

    beforeEach(
      async (): Promise<void> => {
        account = await accountService.create({
          asset: randomAsset(),
          balanceWithdrawalThreshold: BigInt(10)
        })
        await expect(account.processAt).toEqual(null)
      }
    )

    test('Schedules account withdrawal', async (): Promise<void> => {
      assert.ok(account.balanceWithdrawalThreshold)
      await expect(
        accountingService.createDeposit({
          id: uuid(),
          accountId: account.id,
          amount: account.balanceWithdrawalThreshold
        })
      ).resolves.toBeUndefined()

      const now = new Date()
      jest.useFakeTimers('modern')
      jest.setSystemTime(now)
      await account.handlePayment(accountingService)
      await expect(account.processAt).toEqual(now)
    })

    test('Ignores account already scheduled for withdrawal', async (): Promise<void> => {
      assert.ok(account.balanceWithdrawalThreshold)
      await expect(
        accountingService.createDeposit({
          id: uuid(),
          accountId: account.id,
          amount: account.balanceWithdrawalThreshold
        })
      ).resolves.toBeUndefined()

      const processAt = new Date()
      await account.$query(knex).patch({
        processAt
      })
      await account.handlePayment(accountingService)
      await expect(account.processAt).toEqual(processAt)
    })

    test('Ignores account with insufficient balance for withdrawal', async (): Promise<void> => {
      assert.ok(account.balanceWithdrawalThreshold)
      await expect(
        accountingService.createDeposit({
          id: uuid(),
          accountId: account.id,
          amount: account.balanceWithdrawalThreshold - BigInt(1)
        })
      ).resolves.toBeUndefined()

      await account.handlePayment(accountingService)
      await expect(account.processAt).toEqual(null)
    })
  })

  describe('processNext', (): void => {
    let account: Account
    const startingBalance = BigInt(10)

    beforeEach(
      async (): Promise<void> => {
        account = await accountService.create({
          asset: randomAsset()
        })
        await expect(account.processAt).toEqual(null)
        await expect(
          accountingService.createDeposit({
            id: uuid(),
            accountId: account.id,
            amount: startingBalance
          })
        ).resolves.toBeUndefined()
        await account.$query(knex).patch({
          processAt: new Date()
        })
      }
    )

    function mockWebhookServer(status = 200): nock.Scope {
      return nock(webhookUrl.origin)
        .post(webhookUrl.pathname, (body): boolean => {
          expect(body.type).toEqual(EventType.AccountWebMonetization)
          expect(body.data.account.id).toEqual(account.id)
          expect(body.data.account.balance).toEqual(startingBalance.toString())
          return true
        })
        .reply(status)
    }

    test('Does not process account not scheduled for withdrawal', async (): Promise<void> => {
      await account.$query(knex).patch({
        processAt: new Date(Date.now() + 10_000)
      })
      await expect(accountService.processNext()).resolves.toBeUndefined()
      await expect(accountService.get(account.id)).resolves.toEqual(account)
      await expect(accountingService.getBalance(account.id)).resolves.toEqual(
        startingBalance
      )
    })

    test('Withdraws account liquidity', async (): Promise<void> => {
      const scope = mockWebhookServer()
      await expect(accountService.processNext()).resolves.toBe(account.id)
      expect(scope.isDone()).toBe(true)
      await expect(accountService.get(account.id)).resolves.toMatchObject({
        processAt: null,
        withdrawal: null
      })
      await expect(accountingService.getBalance(account.id)).resolves.toEqual(
        BigInt(0)
      )
    })

    test("Doesn't withdraw on webhook error", async (): Promise<void> => {
      assert.ok(account.processAt)
      const scope = mockWebhookServer(504)
      await expect(accountService.processNext()).resolves.toBe(account.id)
      expect(scope.isDone()).toBe(true)
      await expect(accountService.get(account.id)).resolves.toMatchObject({
        processAt: new Date(account.processAt.getTime() + 10_000),
        withdrawal: {
          amount: startingBalance,
          attempts: 1
        }
      })
      await expect(accountingService.getBalance(account.id)).resolves.toEqual(
        startingBalance
      )
    })

    test("Doesn't withdraw on webhook timeout", async (): Promise<void> => {
      assert.ok(account.processAt)
      const scope = nock(webhookUrl.origin)
        .post(webhookUrl.pathname)
        .delayConnection(Config.webhookTimeout + 1)
        .reply(200)
      await expect(accountService.processNext()).resolves.toBe(account.id)
      expect(scope.isDone()).toBe(true)
      await expect(accountService.get(account.id)).resolves.toMatchObject({
        processAt: new Date(account.processAt.getTime() + 10_000),
        withdrawal: {
          amount: startingBalance,
          attempts: 1
        }
      })
      await expect(accountingService.getBalance(account.id)).resolves.toEqual(
        startingBalance
      )
    })
  })
})
