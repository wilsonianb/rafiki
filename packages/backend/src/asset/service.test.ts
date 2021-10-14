import Knex from 'knex'
import { WorkerUtils, makeWorkerUtils } from 'graphile-worker'
import { v4 as uuid } from 'uuid'

import { AssetError, isAssetError } from './errors'
import { Asset } from './model'
import { AssetService } from './service'
import { createTestApp, TestContainer } from '../tests/app'
import { Pagination } from '../shared/pagination'
import { randomAsset } from '../tests/asset'
import { resetGraphileDb } from '../tests/graphileDb'
import { truncateTables } from '../tests/tableManager'
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

  describe('Create', (): void => {
    test('Asset can be created', async (): Promise<void> => {
      const options = {
        code: 'USD',
        scale: 2
      }
      const asset = await assetService.create(options)
      expect(isAssetError(asset)).toEqual(false)
      if (isAssetError(asset)) {
        fail()
      }
      const expectedAsset = {
        ...options,
        id: asset.id,
        liquidityBalanceId: asset.liquidityBalanceId,
        settlementBalanceId: asset.settlementBalanceId,
        outgoingPaymentsBalanceId: asset.outgoingPaymentsBalanceId
      }
      await expect(asset).toMatchObject(expectedAsset)
      await expect(assetService.get(asset)).resolves.toMatchObject(
        expectedAsset
      )
    })

    test('Returns error for duplicate asset', async (): Promise<void> => {
      const options = {
        code: 'USD',
        scale: 2
      }
      expect(isAssetError(await assetService.create(options))).toEqual(false)
      await expect(assetService.create(options)).resolves.toEqual(
        AssetError.AssetExists
      )
    })
  })

  describe('Get', (): void => {
    test('Can get asset by id', async (): Promise<void> => {
      const asset = await assetService.create({
        code: 'EUR',
        scale: 2
      })
      expect(isAssetError(asset)).toEqual(false)
      if (isAssetError(asset)) {
        fail()
      }
      await expect(assetService.getById(asset.id)).resolves.toEqual(asset)

      await expect(assetService.getById(uuid())).resolves.toBeUndefined()
    })

    test('Can get asset by code and scale', async (): Promise<void> => {
      const codeAndScale = {
        code: 'EUR',
        scale: 2
      }
      await expect(assetService.get(codeAndScale)).resolves.toBeUndefined()
      const asset = await assetService.create(codeAndScale)
      await expect(assetService.get(codeAndScale)).resolves.toEqual(asset)
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
      await assetService.create(asset)
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
      await assetService.create(asset)
      await expect(assetService.getSettlementBalance(asset)).resolves.toEqual(
        0n
      )
    })

    test('Can get reserved outgoing payments balance', async (): Promise<void> => {
      const asset = {
        code: 'CNY',
        scale: 2
      }
      await expect(
        assetService.getOutgoingPaymentsBalance(asset)
      ).resolves.toBeUndefined()
      await assetService.create(asset)
      await expect(
        assetService.getOutgoingPaymentsBalance(asset)
      ).resolves.toEqual(0n)
    })
  })

  describe('Asset pagination', (): void => {
    let assetsCreated: Asset[]

    beforeEach(async (): Promise<void> => {
      assetsCreated = []
      for (let i = 0; i < 40; i++) {
        const asset = await assetService.create(randomAsset())
        if (isAssetError(asset)) {
          fail()
        }
        assetsCreated.push(asset)
      }
    }, 10_000)

    test('Defaults to fetching first 20 items', async (): Promise<void> => {
      const assets = await assetService.getPage()
      expect(assets).toHaveLength(20)
      expect(assets[0].id).toEqual(assetsCreated[0].id)
      expect(assets[19].id).toEqual(assetsCreated[19].id)
      expect(assets[20]).toBeUndefined()
    })

    test('Can change forward pagination limit', async (): Promise<void> => {
      const pagination: Pagination = {
        first: 10
      }
      const assets = await assetService.getPage(pagination)
      expect(assets).toHaveLength(10)
      expect(assets[0].id).toEqual(assetsCreated[0].id)
      expect(assets[9].id).toEqual(assetsCreated[9].id)
      expect(assets[10]).toBeUndefined()
    }, 10_000)

    test('Can paginate forwards from a cursor', async (): Promise<void> => {
      const pagination: Pagination = {
        after: assetsCreated[19].id
      }
      const assets = await assetService.getPage(pagination)
      expect(assets).toHaveLength(20)
      expect(assets[0].id).toEqual(assetsCreated[20].id)
      expect(assets[19].id).toEqual(assetsCreated[39].id)
      expect(assets[20]).toBeUndefined()
    })

    test('Can paginate forwards from a cursor with a limit', async (): Promise<void> => {
      const pagination: Pagination = {
        first: 10,
        after: assetsCreated[9].id
      }
      const assets = await assetService.getPage(pagination)
      expect(assets).toHaveLength(10)
      expect(assets[0].id).toEqual(assetsCreated[10].id)
      expect(assets[9].id).toEqual(assetsCreated[19].id)
      expect(assets[10]).toBeUndefined()
    })

    test("Can't change backward pagination limit on it's own.", async (): Promise<void> => {
      const pagination: Pagination = {
        last: 10
      }
      const assets = assetService.getPage(pagination)
      await expect(assets).rejects.toThrow(
        "Can't paginate backwards from the start."
      )
    })

    test('Can paginate backwards from a cursor', async (): Promise<void> => {
      const pagination: Pagination = {
        before: assetsCreated[20].id
      }
      const assets = await assetService.getPage(pagination)
      expect(assets).toHaveLength(20)
      expect(assets[0].id).toEqual(assetsCreated[0].id)
      expect(assets[19].id).toEqual(assetsCreated[19].id)
      expect(assets[20]).toBeUndefined()
    })

    test('Can paginate backwards from a cursor with a limit', async (): Promise<void> => {
      const pagination: Pagination = {
        last: 5,
        before: assetsCreated[10].id
      }
      const assets = await assetService.getPage(pagination)
      expect(assets).toHaveLength(5)
      expect(assets[0].id).toEqual(assetsCreated[5].id)
      expect(assets[4].id).toEqual(assetsCreated[9].id)
      expect(assets[5]).toBeUndefined()
    })

    test('Backwards/Forwards pagination results in same order.', async (): Promise<void> => {
      const paginationForwards = {
        first: 10
      }
      const accountsForwards = await assetService.getPage(paginationForwards)
      const paginationBackwards = {
        last: 10,
        before: assetsCreated[10].id
      }
      const accountsBackwards = await assetService.getPage(paginationBackwards)
      expect(accountsForwards).toHaveLength(10)
      expect(accountsBackwards).toHaveLength(10)
      expect(accountsForwards).toEqual(accountsBackwards)
    })

    test('Providing before and after results in forward pagination', async (): Promise<void> => {
      const pagination: Pagination = {
        after: assetsCreated[19].id,
        before: assetsCreated[19].id
      }
      const assets = await assetService.getPage(pagination)
      expect(assets).toHaveLength(20)
      expect(assets[0].id).toEqual(assetsCreated[20].id)
      expect(assets[19].id).toEqual(assetsCreated[39].id)
      expect(assets[20]).toBeUndefined()
    })

    test("Can't request less than 0 assets", async (): Promise<void> => {
      const pagination: Pagination = {
        first: -1
      }
      const assets = assetService.getPage(pagination)
      await expect(assets).rejects.toThrow('Pagination index error')
    })

    test("Can't request more than 100 assets", async (): Promise<void> => {
      const pagination: Pagination = {
        first: 101
      }
      const assets = assetService.getPage(pagination)
      await expect(assets).rejects.toThrow('Pagination index error')
    })
  })
})
