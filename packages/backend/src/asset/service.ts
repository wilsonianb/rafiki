import {
  Asset,
  LiquidityAccount,
  SettlementAccount,
  SentAccount
} from './model'
import { BaseService } from '../shared/baseService'
import { Transaction } from 'knex'
import { AccountService } from '../account/service'

export interface AssetOptions {
  code: string
  scale: number
}

export interface AssetService {
  get(asset: AssetOptions, trx?: Transaction): Promise<void | Asset>
  getOrCreate(asset: AssetOptions): Promise<Asset>
  getById(id: string, trx?: Transaction): Promise<void | Asset>
}

interface ServiceDependencies extends BaseService {
  accountService: AccountService
}

export async function createAssetService({
  logger,
  knex,
  accountService
}: ServiceDependencies): Promise<AssetService> {
  const log = logger.child({
    service: 'AssetService'
  })
  const deps: ServiceDependencies = {
    logger: log,
    knex,
    accountService
  }
  return {
    get: (asset, trx) => getAsset(deps, asset, trx),
    getOrCreate: (asset) => getOrCreateAsset(deps, asset),
    getById: (id, trx) => getAssetById(deps, id, trx)
  }
}

async function getAsset(
  deps: ServiceDependencies,
  { code, scale }: AssetOptions,
  trx?: Transaction
): Promise<void | Asset> {
  return await Asset.query(trx || deps.knex)
    .findOne({ code, scale })
    .withGraphFetched(Asset.graph)
}

async function getOrCreateAsset(
  deps: ServiceDependencies,
  { code, scale }: AssetOptions
): Promise<Asset> {
  const asset = await Asset.query(deps.knex)
    .findOne({ code, scale })
    .withGraphFetched(Asset.graph)
  if (asset) {
    return asset
  } else {
    // Asset rows include a smallserial 'unit' column that would have sequence gaps
    // if a transaction is rolled back.
    // https://www.postgresql.org/docs/current/datatype-numeric.html#DATATYPE-SERIAL
    //
    // However, we need to know the 'unit' column value from the inserted asset row
    // before we can create the liquidity and settlement tigerbeetle balances.
    return await Asset.transaction(async (trx) => {
      const asset = await Asset.query(trx).insertAndFetch({
        code,
        scale
      })
      const { id: liquidityAccountId } = await deps.accountService.create(
        {
          assetId: asset.id
        },
        trx
      )
      await LiquidityAccount.query(trx).insert({
        id: asset.id,
        accountId: liquidityAccountId
      })
      const { id: settlementAccountId } = await deps.accountService.create(
        {
          assetId: asset.id,
          debitBalance: true
        },
        trx
      )
      await SettlementAccount.query(trx).insert({
        id: asset.id,
        accountId: settlementAccountId
      })
      const { id: sentAccountId } = await deps.accountService.create(
        {
          assetId: asset.id,
          debitBalance: true
        },
        trx
      )
      await SentAccount.query(trx).insert({
        id: asset.id,
        accountId: sentAccountId
      })

      return await Asset.query(trx)
        .findById(asset.id)
        .withGraphFetched(Asset.graph)
    })
  }
}

async function getAssetById(
  deps: ServiceDependencies,
  id: string,
  trx?: Transaction
): Promise<void | Asset> {
  return await Asset.query(trx || deps.knex)
    .findById(id)
    .withGraphJoined(Asset.graph)
}
