import assert from 'assert'
import Knex from 'knex'
import { WorkerUtils, makeWorkerUtils } from 'graphile-worker'
// import { parse, end } from 'iso8601-duration'
import { v4 as uuid } from 'uuid'

import { GrantService } from './service'
import { CreateError, isCreateError } from './errors'
// import { Grant } from './model'
import { createTestApp, TestContainer } from '../../tests/app'
import { resetGraphileDb } from '../../tests/graphileDb'
import { GraphileProducer } from '../../messaging/graphileProducer'
import { Config } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { randomAsset } from '../../tests/asset'
import { truncateTables } from '../../tests/tableManager'

const DAY = 24 * 60 * 60 * 1000

describe('Grant Service', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let workerUtils: WorkerUtils
  let grantService: GrantService
  let knex: Knex
  const messageProducer = new GraphileProducer()
  const mockMessageProducer = {
    send: jest.fn()
  }
  const { code: assetCode, scale: assetScale } = randomAsset()
  const amount = BigInt(100)

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
      grantService = await deps.use('grantService')
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
    const now = Date.now()
    // don't modify now
    test.each`
      startAt                | interval     | intervalEnd            | description
      ${undefined}           | ${undefined} | ${null}                | ${'single interval'}
      ${new Date(now)}       | ${'P1D'}     | ${new Date(now + DAY)} | ${'first interval'}
      ${new Date(now - DAY)} | ${'P1D'}     | ${new Date(now + DAY)} | ${'second interval'}
    `(
      'A grant can be created and fetched ($description)',
      async ({ startAt, interval, intervalEnd }): Promise<void> => {
        const id = uuid()
        // console.log(startAt.getTime())
        const grant = await grantService.create({
          id,
          amount,
          assetCode,
          assetScale,
          startAt,
          interval
        })
        assert.ok(!isCreateError(grant))
        expect(grant).toMatchObject({
          id,
          amount,
          assetCode,
          assetScale,
          balance: amount,
          interval: interval || null,
          intervalEnd
        })
        await expect(grantService.get(id)).resolves.toEqual(grant)
      }
    )

    test('Cannot create grant with invalid interval', async (): Promise<void> => {
      await expect(
        grantService.create({
          id: uuid(),
          amount,
          assetCode,
          assetScale,
          startAt: new Date(),
          interval: 'fail'
        })
      ).resolves.toEqual(CreateError.InvalidInterval)
    })

    test('Cannot create grant with invalid startAt', async (): Promise<void> => {
      await expect(
        grantService.create({
          id: uuid(),
          amount,
          assetCode,
          assetScale,
          startAt: new Date(Date.now() + 10_000),
          interval: 'fail'
        })
      ).resolves.toEqual(CreateError.InvalidStartAt)
    })

    test('Cannot fetch a bogus grant', async (): Promise<void> => {
      await expect(grantService.get(uuid())).resolves.toBeUndefined()
    })
  })

  // describe('processNext', (): void => {
  //   describe.each`
  //     interval | expiresAt                      | expiring | description
  //     ${null}  | ${null}                        | ${false} | ${'single indefinite interval'}
  //     ${null}  | ${new Date(Date.now() + YEAR)} | ${true}  | ${'single expiring interval'}
  //     ${'P1M'} | ${null}                        | ${false} | ${'indefinite intervals'}
  //     ${'P2Y'} | ${new Date(Date.now() + YEAR)} | ${true}  | ${'<1 full interval'}
  //     ${'P9M'} | ${new Date(Date.now() + YEAR)} | ${false} | ${'expire 2nd interval'}
  //     ${'P1M'} | ${new Date(Date.now() + YEAR)} | ${false} | ${'2+ full intervals'}
  //   `('$description', ({ interval, expiresAt, expiring }): void => {
  //     let grant: Grant
  //     describe.each`
  //       balance       | description
  //       ${amount}     | ${'unused'}
  //       ${BigInt(50)} | ${'partial'}
  //       ${BigInt(0)}  | ${'empty'}
  //     `('$description balance', ({ balance }): void => {
  //       beforeEach(
  //         async (): Promise<void> => {
  //           grant = (await grantService.create({
  //             accountId,
  //             amount,
  //             assetCode,
  //             assetScale,
  //             expiresAt,
  //             interval
  //           })) as Grant
  //           assert.ok(!isCreateError(grant))
  //           await grant.$query(knex).patch({ balance })
  //           expect(grant).toMatchObject({
  //             balance
  //           })
  //         }
  //       )

  //       if (interval) {
  //         test('Starts new interval', async (): Promise<void> => {
  //           assert.ok(grant.processAt)
  //           jest.useFakeTimers('modern')
  //           jest.setSystemTime(grant.processAt)
  //           await expect(grantService.processNext()).resolves.toBe(grant.id)
  //           const fullInterval = end(parse(interval), grant.processAt)
  //           await expect(grantService.get(grant.id)).resolves.toMatchObject({
  //             balance: grant.amount,
  //             processAt:
  //               expiresAt && expiresAt < fullInterval ? expiresAt : fullInterval
  //           })
  //         })
  //       }

  //       test('Does not process a grant mid-interval', async (): Promise<void> => {
  //         await expect(grantService.processNext()).resolves.toBeUndefined()
  //         await expect(grantService.get(grant.id)).resolves.toEqual(grant)
  //       })
  //     })
  //   })
  // })
})
