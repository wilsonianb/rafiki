import assert from 'assert'
import { AxiosResponse } from 'axios'
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
import { EventType, WebhookService } from '../../webhook/service'

describe('Open Payments Account Service', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let workerUtils: WorkerUtils
  let accountService: AccountService
  let accountingService: AccountingService
  let webhookService: WebhookService
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
      webhookService = await deps.use('webhookService')
    }
  )

  afterEach(
    async (): Promise<void> => {
      jest.restoreAllMocks()
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

      const processAt = new Date(Date.now() - 10_000)
      await account.$query(knex).patch({
        processAt,
        withdrawal: {
          id: uuid(),
          amount: BigInt(5),
          attempts: 0,
          transferId: uuid()
        }
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
          processAt: new Date(),
          withdrawal: {
            id: uuid(),
            amount: BigInt(5),
            attempts: 0,
            transferId: uuid()
          }
        })
      }
    )

    function mockWebhookServer(status = 200): nock.Scope {
      return nock(webhookUrl.origin)
        .post(webhookUrl.pathname, (body): boolean => {
          assert.ok(account.withdrawal)
          expect(body).toMatchObject({
            id: account.withdrawal.id,
            type: EventType.AccountWebMonetization,
            data: {
              account: {
                id: account.id,
                balance: account.withdrawal.amount.toString()
              }
            }
          })
          return true
        })
        .reply(status)
    }

    test('Does not process account not scheduled for withdrawal', async (): Promise<void> => {
      await account.$query(knex).patch({
        processAt: new Date(Date.now() + 10_000)
      })
      await expect(accountService.processNext()).resolves.toBeUndefined()
      await account.$query(knex).patch({
        processAt: new Date(),
        withdrawal: null
      })
      await expect(accountService.processNext()).resolves.toBeUndefined()
      await expect(accountService.get(account.id)).resolves.toEqual(account)
      await expect(accountingService.getBalance(account.id)).resolves.toEqual(
        startingBalance
      )
    })

    test('Withdraws account liquidity', async (): Promise<void> => {
      assert.ok(account.withdrawal)
      const scope = mockWebhookServer()
      await expect(accountService.processNext()).resolves.toBe(account.id)
      expect(scope.isDone()).toBe(true)
      await expect(accountService.get(account.id)).resolves.toMatchObject({
        processAt: null,
        withdrawal: null
      })
      await expect(accountingService.getBalance(account.id)).resolves.toEqual(
        startingBalance - account.withdrawal.amount
      )
    })

    test('Schedules next withdrawal if remaining balance already exceeds threshold', async (): Promise<void> => {
      assert.ok(account.processAt && account.withdrawal)
      await account.$query(knex).patch({
        balanceWithdrawalThreshold: BigInt(5)
      })
      expect(account.balanceWithdrawalThreshold).toBeGreaterThanOrEqual(
        startingBalance - account.withdrawal.amount
      )

      // nock doesn't work with 'modern' fake timers
      // https://github.com/nock/nock/issues/2200
      // const scope = mockWebhookServer()
      jest
        .spyOn(webhookService, 'send')
        .mockResolvedValueOnce({ status: 200 } as AxiosResponse)

      const now = new Date()
      jest.useFakeTimers('modern')
      jest.setSystemTime(now)
      expect(account.processAt.getTime()).toBeLessThan(now.getTime())

      await expect(accountService.processNext()).resolves.toBe(account.id)
      await expect(accountService.get(account.id)).resolves.toMatchObject({
        processAt: now,
        withdrawal: {
          amount: startingBalance - account.withdrawal.amount,
          attempts: 0
        }
      })
      await expect(accountingService.getBalance(account.id)).resolves.toEqual(
        startingBalance - account.withdrawal.amount
      )
    })

    test("Doesn't withdraw on webhook error", async (): Promise<void> => {
      assert.ok(account.processAt && account.withdrawal)
      const scope = mockWebhookServer(504)
      await expect(accountService.processNext()).resolves.toBe(account.id)
      expect(scope.isDone()).toBe(true)
      await expect(accountService.get(account.id)).resolves.toMatchObject({
        processAt: new Date(account.processAt.getTime() + 10_000),
        withdrawal: {
          id: account.withdrawal.id,
          amount: account.withdrawal.amount,
          attempts: 1
        }
      })
      await expect(accountingService.getBalance(account.id)).resolves.toEqual(
        startingBalance
      )
    })

    test("Doesn't withdraw on webhook timeout", async (): Promise<void> => {
      assert.ok(account.processAt && account.withdrawal)
      const scope = nock(webhookUrl.origin)
        .post(webhookUrl.pathname)
        .delayConnection(Config.webhookTimeout + 1)
        .reply(200)
      await expect(accountService.processNext()).resolves.toBe(account.id)
      expect(scope.isDone()).toBe(true)
      await expect(accountService.get(account.id)).resolves.toMatchObject({
        processAt: new Date(account.processAt.getTime() + 10_000),
        withdrawal: {
          id: account.withdrawal.id,
          amount: account.withdrawal.amount,
          attempts: 1
        }
      })
      await expect(accountingService.getBalance(account.id)).resolves.toEqual(
        startingBalance
      )
    })

    test('Retries withdrawal with same amount', async (): Promise<void> => {
      assert.ok(account.processAt && account.withdrawal)
      let scope = mockWebhookServer(504)
      await expect(accountService.processNext()).resolves.toBe(account.id)
      expect(scope.isDone()).toBe(true)

      scope = mockWebhookServer()
      await expect(accountService.processNext()).resolves.toBe(account.id)
      expect(scope.isDone()).toBe(true)
      await expect(accountService.get(account.id)).resolves.toMatchObject({
        processAt: null,
        withdrawal: null
      })
      await expect(accountingService.getBalance(account.id)).resolves.toEqual(
        startingBalance - account.withdrawal.amount
      )
    })
  })
})
