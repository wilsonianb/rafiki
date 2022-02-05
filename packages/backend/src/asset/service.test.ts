import { Knex } from 'knex'
import { WorkerUtils, makeWorkerUtils } from 'graphile-worker'
import { StartedTestContainer } from 'testcontainers'
import { v4 as uuid } from 'uuid'

import { AssetService } from './service'
import { createTestApp, TestContainer } from '../tests/app'
import { randomAsset } from '../tests/asset'
import { resetGraphileDb } from '../tests/graphileDb'
import { truncateTables } from '../tests/tableManager'
import {
  startTigerbeetleContainer,
  TIGERBEETLE_PORT
} from '../tests/tigerbeetle'
import { GraphileProducer } from '../messaging/graphileProducer'
import { Config } from '../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../'
import { AppServices } from '../app'

describe('Asset Service', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let workerUtils: WorkerUtils
  let assetService: AssetService
  let knex: Knex
  let tigerbeetleContainer: StartedTestContainer
  const messageProducer = new GraphileProducer()
  const mockMessageProducer = {
    send: jest.fn()
  }

  beforeEach(
    async (): Promise<void> => {
      tigerbeetleContainer = await startTigerbeetleContainer()
      Config.tigerbeetleReplicaAddresses = [
        tigerbeetleContainer.getMappedPort(TIGERBEETLE_PORT)
      ]

      deps = await initIocContainer(Config)
      deps.bind('messageProducer', async () => mockMessageProducer)
      appContainer = await createTestApp(deps)
      workerUtils = await makeWorkerUtils({
        connectionString: appContainer.connectionUrl
      })
      await workerUtils.migrate()
      messageProducer.setUtils(workerUtils)
      knex = await deps.use('knex')
      assetService = await deps.use('assetService')
    }
  )

  afterEach(
    async (): Promise<void> => {
      await truncateTables(knex)
      await resetGraphileDb(knex)
      await appContainer.shutdown()
      await workerUtils.release()
      await tigerbeetleContainer.stop()
    }
  )

  describe('Create or Get Asset', (): void => {
    test('Asset can be created or fetched', async (): Promise<void> => {
      const asset = randomAsset()
      await expect(assetService.get(asset)).resolves.toBeUndefined()
      const newAsset = await assetService.getOrCreate(asset)
      const expectedAsset = {
        ...asset,
        id: newAsset.id,
        unit: newAsset.unit
      }
      await expect(newAsset).toMatchObject(expectedAsset)
      await expect(assetService.get(asset)).resolves.toMatchObject(
        expectedAsset
      )
      await expect(assetService.getOrCreate(asset)).resolves.toMatchObject(
        expectedAsset
      )
    })

    test('Asset accounts are created', async (): Promise<void> => {
      const accountingService = await deps.use('accountingService')
      const unit = 1

      await expect(
        accountingService.getSettlementBalance(unit)
      ).resolves.toBeUndefined()

      const asset = await assetService.getOrCreate(randomAsset())
      expect(asset.unit).toEqual(unit)

      await expect(accountingService.getBalance(asset.id)).resolves.toEqual(
        BigInt(0)
      )
      await expect(
        accountingService.getSettlementBalance(unit)
      ).resolves.toEqual(BigInt(0))
    })

    test('Can get asset by id', async (): Promise<void> => {
      const asset = await assetService.getOrCreate({
        code: 'EUR',
        scale: 2
      })
      await expect(assetService.getById(asset.id)).resolves.toEqual(asset)

      await expect(assetService.getById(uuid())).resolves.toBeUndefined()
    })
  })
})
