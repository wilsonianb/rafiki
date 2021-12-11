import assert from 'assert'
import Knex from 'knex'
import nock from 'nock'
import { WorkerUtils, makeWorkerUtils } from 'graphile-worker'
import { parse, end } from 'iso8601-duration'
import { v4 as uuid } from 'uuid'

import { GrantService } from './service'
import { CreateError, isCreateError } from './errors'
import { Grant } from './model'
import { createTestApp, TestContainer } from '../../tests/app'
import { AccountService } from '../account/service'
import { resetGraphileDb } from '../../tests/graphileDb'
import { GraphileProducer } from '../../messaging/graphileProducer'
import { Config } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { randomAsset } from '../../tests/asset'
import { truncateTables } from '../../tests/tableManager'

const DAY = 24 * 60 * 60 * 1000
const YEAR = 365 * DAY

describe('Grant Service', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let workerUtils: WorkerUtils
  let grantService: GrantService
  let accountService: AccountService
  let knex: Knex
  let accountId: string
  const messageProducer = new GraphileProducer()
  const mockMessageProducer = {
    send: jest.fn()
  }
  const { code: assetCode, scale: assetScale } = randomAsset()
  const prices = {
    [assetCode]: 1.0
  }
  const amount = BigInt(100)

  beforeAll(
    async (): Promise<void> => {
      Config.pricesUrl = 'https://test.prices'
      nock(Config.pricesUrl)
        .get('/')
        .reply(200, () => prices)
        .persist()
      deps = await initIocContainer(Config)
      deps.bind('messageProducer', async () => mockMessageProducer)
      appContainer = await createTestApp(deps)
      workerUtils = await makeWorkerUtils({
        connectionString: appContainer.connectionUrl
      })
      await workerUtils.migrate()
      messageProducer.setUtils(workerUtils)
      knex = await deps.use('knex')
      grantService = await deps.use('grantService')
      accountService = await deps.use('accountService')
    }
  )

  beforeEach(
    async (): Promise<void> => {
      const asset = randomAsset()
      accountId = (await accountService.create({ asset })).id
      prices[asset.code] = 2.0
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

  describe('Create/Get Grant', (): void => {
    describe.each`
      interval | expiresAt                      | expiring | description
      ${null}  | ${null}                        | ${false} | ${'single indefinite interval'}
      ${null}  | ${new Date(Date.now() + YEAR)} | ${true}  | ${'single expiring interval'}
      ${'P1M'} | ${null}                        | ${false} | ${'indefinite intervals'}
      ${'P2Y'} | ${new Date(Date.now() + YEAR)} | ${true}  | ${'expiresAt < interval'}
      ${'P1M'} | ${new Date(Date.now() + YEAR)} | ${false} | ${'interval < expiresAt'}
    `('$description', ({ interval, expiresAt, expiring }): void => {
      describe.each`
        startAt                       | active   | starting | description
        ${null}                       | ${true}  | ${false} | ${'start on create'}
        ${new Date(Date.now() + DAY)} | ${false} | ${true}  | ${'create pre-start'}
        ${new Date(Date.now() - DAY)} | ${true}  | ${false} | ${'create post-start'}
      `('$description', ({ startAt, active, starting }): void => {
        test('A grant can be created and fetched', async (): Promise<void> => {
          const options = {
            accountId,
            amount,
            assetCode,
            assetScale,
            startAt,
            expiresAt,
            interval
          }
          const grant = await grantService.create(options)
          assert.ok(!isCreateError(grant))
          let processAt: Date | undefined | null = null
          if (starting) {
            processAt = grant.startAt
          } else if (expiring) {
            processAt = grant.expiresAt
          } else if (grant.interval) {
            processAt = end(
              parse(grant.interval),
              grant.startAt || grant.createdAt
            )
          }
          expect(grant).toMatchObject({
            ...options,
            id: grant.id,
            account: await accountService.get(accountId),
            balance: active ? options.amount : BigInt(0),
            processAt
          })
          const retrievedGrant = await grantService.get(grant.id)
          if (!retrievedGrant) throw new Error('grant not found')
          expect(retrievedGrant).toEqual(grant)
        })

        test('Cannot create grant for nonexistent account', async (): Promise<void> => {
          await expect(
            grantService.create({
              accountId: uuid(),
              amount,
              assetCode,
              assetScale
            })
          ).resolves.toEqual(CreateError.UnknownAccount)
        })

        test('Cannot create grant for unknown asset', async (): Promise<void> => {
          const { code: assetCode } = randomAsset()
          await expect(
            grantService.create({
              accountId: uuid(),
              amount,
              assetCode,
              assetScale
            })
          ).resolves.toEqual(CreateError.UnknownAsset)
        })

        if (expiring) {
          test('Cannot create expired grant', async (): Promise<void> => {
            await expect(
              grantService.create({
                accountId: uuid(),
                amount,
                assetCode,
                assetScale,
                expiresAt: new Date(Date.now() - 1)
              })
            ).resolves.toEqual(CreateError.InvalidExpiresAt)
          })
        }

        if (interval) {
          test('Cannot create grant with invalid interval', async (): Promise<void> => {
            await expect(
              grantService.create({
                accountId: uuid(),
                amount,
                assetCode,
                assetScale,
                interval: 'fail'
              })
            ).resolves.toEqual(CreateError.InvalidInterval)
          })
        }
      })
    })

    test('Cannot fetch a bogus grant', async (): Promise<void> => {
      await expect(grantService.get(uuid())).resolves.toBeUndefined()
    })
  })

  describe('processNext', (): void => {
    describe.each`
      interval | expiresAt                      | expiring | description
      ${null}  | ${null}                        | ${false} | ${'single indefinite interval'}
      ${null}  | ${new Date(Date.now() + YEAR)} | ${true}  | ${'single expiring interval'}
      ${'P1M'} | ${null}                        | ${false} | ${'indefinite intervals'}
      ${'P2Y'} | ${new Date(Date.now() + YEAR)} | ${true}  | ${'<1 full interval'}
      ${'P9M'} | ${new Date(Date.now() + YEAR)} | ${false} | ${'expire 2nd interval'}
      ${'P1M'} | ${new Date(Date.now() + YEAR)} | ${false} | ${'2+ full intervals'}
    `('$description', ({ interval, expiresAt, expiring }): void => {
      let grant: Grant

      describe('activate', (): void => {
        beforeEach(
          async (): Promise<void> => {
            const startAt = new Date(Date.now() + DAY)
            grant = (await grantService.create({
              accountId,
              amount,
              assetCode,
              assetScale,
              startAt,
              expiresAt,
              interval
            })) as Grant
            assert.ok(!isCreateError(grant))
            expect(grant).toMatchObject({
              balance: BigInt(0),
              processAt: startAt
            })
          }
        )

        test('Activates a starting grant', async (): Promise<void> => {
          jest.useFakeTimers('modern')
          jest.setSystemTime(grant.startAt)
          await expect(grantService.processNext()).resolves.toBe(grant.id)
          await expect(grantService.get(grant.id)).resolves.toMatchObject({
            balance: grant.amount,
            processAt: expiring
              ? expiresAt
              : interval
              ? end(parse(interval), grant.startAt)
              : null
          })
        })

        test('Does not activate a grant prior to startAt', async (): Promise<void> => {
          await expect(grantService.processNext()).resolves.toBeUndefined()
          await expect(grantService.get(grant.id)).resolves.toEqual(grant)
        })
      })

      describe.each`
        balance       | description
        ${amount}     | ${'unused'}
        ${BigInt(50)} | ${'partial'}
        ${BigInt(0)}  | ${'empty'}
      `('$description balance', ({ balance }): void => {
        beforeEach(
          async (): Promise<void> => {
            grant = (await grantService.create({
              accountId,
              amount,
              assetCode,
              assetScale,
              expiresAt,
              interval
            })) as Grant
            assert.ok(!isCreateError(grant))
            await grant.$query(knex).patch({ balance })
            expect(grant).toMatchObject({
              balance
            })
          }
        )

        if (expiring) {
          test('Deactivates an expired grant', async (): Promise<void> => {
            assert.ok(grant.processAt)
            jest.useFakeTimers('modern')
            jest.setSystemTime(grant.processAt)
            await expect(grantService.processNext()).resolves.toBe(grant.id)
            await expect(grantService.get(grant.id)).resolves.toMatchObject({
              balance: BigInt(0),
              processAt: null
            })
          })
        } else if (interval) {
          test('Starts new interval', async (): Promise<void> => {
            assert.ok(grant.processAt)
            jest.useFakeTimers('modern')
            jest.setSystemTime(grant.processAt)
            await expect(grantService.processNext()).resolves.toBe(grant.id)
            const fullInterval = end(parse(interval), grant.processAt)
            await expect(grantService.get(grant.id)).resolves.toMatchObject({
              balance: grant.amount,
              processAt:
                expiresAt && expiresAt < fullInterval ? expiresAt : fullInterval
            })
          })
        }

        test('Does not process a grant mid-interval', async (): Promise<void> => {
          await expect(grantService.processNext()).resolves.toBeUndefined()
          await expect(grantService.get(grant.id)).resolves.toEqual(grant)
        })
      })
    })
  })
})
