import { Transaction, UniqueViolationError } from 'objection'

import { AssetError } from './errors'
import { Asset } from './model'
import { BalanceService } from '../balance/service'
import { BaseService } from '../shared/baseService'
import { Pagination } from '../shared/pagination'

export interface AssetOptions {
  code: string
  scale: number
}

export interface AssetService {
  create(options: AssetOptions): Promise<Asset | AssetError>
  get(asset: AssetOptions, trx?: Transaction): Promise<void | Asset>
  getById(id: string, trx?: Transaction): Promise<void | Asset>
  getLiquidityBalance(
    asset: AssetOptions,
    trx?: Transaction
  ): Promise<bigint | undefined>
  getSettlementBalance(
    asset: AssetOptions,
    trx?: Transaction
  ): Promise<bigint | undefined>
  getOutgoingPaymentsBalance(
    asset: AssetOptions,
    trx?: Transaction
  ): Promise<bigint | undefined>
  getPage(pagination?: Pagination): Promise<Asset[]>
}

interface ServiceDependencies extends BaseService {
  balanceService: BalanceService
}

export async function createAssetService({
  logger,
  knex,
  balanceService
}: ServiceDependencies): Promise<AssetService> {
  const log = logger.child({
    service: 'AssetService'
  })
  const deps: ServiceDependencies = {
    logger: log,
    knex,
    balanceService
  }
  return {
    create: (options) => createAsset(deps, options),
    get: (asset, trx) => getAsset(deps, asset, trx),
    getById: (id, trx) => getAssetById(deps, id, trx),
    getLiquidityBalance: (asset, trx) => getLiquidityBalance(deps, asset, trx),
    getSettlementBalance: (asset, trx) =>
      getSettlementBalance(deps, asset, trx),
    getOutgoingPaymentsBalance: (asset, trx) =>
      getOutgoingPaymentsBalance(deps, asset, trx),
    getPage: (pagination?) => getAssetsPage(deps, pagination)
  }
}

async function createAsset(
  deps: ServiceDependencies,
  { code, scale }: AssetOptions
): Promise<Asset | AssetError> {
  // Asset rows include a smallserial 'unit' column that would have sequence gaps
  // if a transaction is rolled back.
  // https://www.postgresql.org/docs/current/datatype-numeric.html#DATATYPE-SERIAL
  //
  // However, we need to know the 'unit' column value from the inserted asset row
  // before we can create the liquidity and settlement tigerbeetle balances,
  // and we don't want to have invalid balance id(s) in the the asset row if the
  // tigerbeetle balance creation fails.
  //
  // If tigerbeetle supported patching a balance's 'unit', we could:
  // 1) create the tigerbeetle balances with empty 'unit's
  // 2) insert new asset row
  // 3) patch the tigerbeetle balance 'unit's
  try {
    return await Asset.transaction(async (trx) => {
      const asset = await Asset.query(trx).insertAndFetch({
        code,
        scale
      })
      const { id: balanceId } = await deps.balanceService.create({
        unit: asset.unit
      })
      const { id: settlementBalanceId } = await deps.balanceService.create({
        debitBalance: true,
        unit: asset.unit
      })
      const {
        id: outgoingPaymentsBalanceId
      } = await deps.balanceService.create({
        debitBalance: true,
        unit: asset.unit
      })
      return await Asset.query(trx).patchAndFetchById(asset.id, {
        balanceId,
        settlementBalanceId,
        outgoingPaymentsBalanceId
      })
    })
  } catch (err) {
    if (err instanceof UniqueViolationError) {
      return AssetError.AssetExists
    }
    throw err
  }
}

async function getAsset(
  deps: ServiceDependencies,
  { code, scale }: AssetOptions,
  trx?: Transaction
): Promise<void | Asset> {
  return await Asset.query(trx || deps.knex)
    .where({ code, scale })
    .limit(1)
    .first()
}

async function getAssetById(
  deps: ServiceDependencies,
  id: string,
  trx?: Transaction
): Promise<void | Asset> {
  return await Asset.query(trx || deps.knex).findById(id)
}

async function getLiquidityBalance(
  deps: ServiceDependencies,
  { code, scale }: AssetOptions,
  trx?: Transaction
): Promise<bigint | undefined> {
  const asset = await Asset.query(trx || deps.knex)
    .where({ code, scale })
    .first()
    .select('balanceId')
  if (asset) {
    const balance = await deps.balanceService.get(asset.balanceId)
    if (balance) {
      return balance.balance
    } else {
      deps.logger.warn({ asset }, 'missing liquidity balance')
    }
  }
}

async function getSettlementBalance(
  deps: ServiceDependencies,
  { code, scale }: AssetOptions,
  trx?: Transaction
): Promise<bigint | undefined> {
  const asset = await Asset.query(trx)
    .where({ code, scale })
    .first()
    .select('settlementBalanceId')
  if (asset) {
    const balance = await deps.balanceService.get(asset.settlementBalanceId)
    if (balance) {
      return balance.balance
    } else {
      deps.logger.warn({ asset }, 'missing settlement balance')
    }
  }
}

async function getOutgoingPaymentsBalance(
  deps: ServiceDependencies,
  { code, scale }: AssetOptions,
  trx?: Transaction
): Promise<bigint | undefined> {
  const asset = await Asset.query(trx)
    .where({ code, scale })
    .first()
    .select('outgoingPaymentsBalanceId')
  if (asset) {
    const balance = await deps.balanceService.get(
      asset.outgoingPaymentsBalanceId
    )
    if (balance) {
      return balance.balance
    } else {
      deps.logger.warn({ asset }, 'missing outgoing payments balance')
    }
  }
}

/** TODO: Base64 encode/decode the cursors
 * Buffer.from("Hello World").toString('base64')
 * Buffer.from("SGVsbG8gV29ybGQ=", 'base64').toString('ascii')
 */

/** getAssetsPage
 * The pagination algorithm is based on the Relay connection specification.
 * Please read the spec before changing things:
 * https://relay.dev/graphql/connections.htm
 * @param pagination Pagination - cursors and limits.
 * @returns Asset[] An array of assets that form a page.
 */
async function getAssetsPage(
  deps: ServiceDependencies,
  pagination?: Pagination
): Promise<Asset[]> {
  if (
    typeof pagination?.before === 'undefined' &&
    typeof pagination?.last === 'number'
  )
    throw new Error("Can't paginate backwards from the start.")

  const first = pagination?.first || 20
  if (first < 0 || first > 100) throw new Error('Pagination index error')
  const last = pagination?.last || 20
  if (last < 0 || last > 100) throw new Error('Pagination index error')

  /**
   * Forward pagination
   */
  if (typeof pagination?.after === 'string') {
    const assets = await Asset.query(deps.knex)
      .whereRaw(
        '("createdAt", "id") > (select "createdAt" :: TIMESTAMP, "id" from "assets" where "id" = ?)',
        [pagination.after]
      )
      .orderBy([
        { column: 'createdAt', order: 'asc' },
        { column: 'id', order: 'asc' }
      ])
      .limit(first)
    return assets
  }

  /**
   * Backward pagination
   */
  if (typeof pagination?.before === 'string') {
    const assets = await Asset.query(deps.knex)
      .whereRaw(
        '("createdAt", "id") < (select "createdAt" :: TIMESTAMP, "id" from "assets" where "id" = ?)',
        [pagination.before]
      )
      .orderBy([
        { column: 'createdAt', order: 'desc' },
        { column: 'id', order: 'desc' }
      ])
      .limit(last)
      .then((resp) => {
        return resp.reverse()
      })
    return assets
  }

  const assets = await Asset.query(deps.knex)
    .orderBy([
      { column: 'createdAt', order: 'asc' },
      { column: 'id', order: 'asc' }
    ])
    .limit(first)
  return assets
}
