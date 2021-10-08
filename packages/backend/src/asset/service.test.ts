import Knex from 'knex'
import { WorkerUtils, makeWorkerUtils } from 'graphile-worker'
import { v4 as uuid } from 'uuid'

import { AssetService } from './service'
import { CreateAssetBalanceError } from './errors'
import { createTestApp, TestContainer } from '../tests/app'
import { resetGraphileDb } from '../tests/graphileDb'
import { truncateTables } from '../tests/tableManager'
import { GraphileProducer } from '../messaging/graphileProducer'
import { Config } from '../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../'
import { AppServices } from '../app'
import { BalanceService } from '../balance/service'
import { BalanceError, CreateBalanceError } from '../balance/errors'

describe('Asset Service', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let workerUtils: WorkerUtils
  let assetService: AssetService
  let balanceService: BalanceService
  let knex: Knex
  const messageProducer = new GraphileProducer()
  const mockMessageProducer = {
    send: jest.fn()
  }

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
      assetService = await deps.use('assetService')
      balanceService = await deps.use('balanceService')
    }
  )

  afterEach(
    async (): Promise<void> => {
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

  describe('Create or Get Asset', (): void => {
    test('Asset can be created or fetched', async (): Promise<void> => {
      const asset = {
        code: 'USD',
        scale: 2
      }
      await expect(assetService.get(asset)).resolves.toBeUndefined()
      const newAsset = await assetService.getOrCreate(asset)
      const expectedAsset = {
        ...asset,
        id: newAsset.id,
        liquidityBalanceId: newAsset.liquidityBalanceId,
        settlementBalanceId: newAsset.settlementBalanceId
      }
      await expect(newAsset).toMatchObject(expectedAsset)
      await expect(assetService.get(asset)).resolves.toMatchObject(
        expectedAsset
      )
      await expect(assetService.getOrCreate(asset)).resolves.toMatchObject(
        expectedAsset
      )
    })

    test('Can get asset by id', async (): Promise<void> => {
      const asset = await assetService.getOrCreate({
        code: 'EUR',
        scale: 2
      })
      await expect(assetService.getById(asset.id)).resolves.toEqual(asset)

      await expect(assetService.getById(uuid())).resolves.toBeUndefined()
    })

    test('Does not create asset when balance creation fails', async (): Promise<void> => {
      const asset = {
        code: 'EUR',
        scale: 3
      }
      jest
        .spyOn(balanceService, 'create')
        .mockImplementationOnce(async () => ({
          index: 0,
          error: BalanceError.DuplicateBalance
        }))
        .mockImplementationOnce(async () => {
          throw new CreateBalanceError(5)
        })
      await expect(assetService.getOrCreate(asset)).rejects.toThrowError(
        new CreateAssetBalanceError(BalanceError.DuplicateBalance)
      )
      await expect(assetService.getOrCreate(asset)).rejects.toThrowError(
        new CreateBalanceError(5)
      )
    })
  })

  describe('Get Asset Balances', (): void => {
    test('Can get liquidity balance', async (): Promise<void> => {
      const asset = {
        code: 'XRP',
        scale: 6
      }
      await expect(
        assetService.getLiquidityBalance(asset)
      ).resolves.toBeUndefined()
      await assetService.getOrCreate(asset)
      await expect(assetService.getLiquidityBalance(asset)).resolves.toEqual(0n)
    })

    test('Can get settlement balance', async (): Promise<void> => {
      const asset = {
        code: 'BTC',
        scale: 9
      }
      await expect(
        assetService.getSettlementBalance(asset)
      ).resolves.toBeUndefined()
      await assetService.getOrCreate(asset)
      await expect(assetService.getSettlementBalance(asset)).resolves.toEqual(
        0n
      )
    })
  })
})
