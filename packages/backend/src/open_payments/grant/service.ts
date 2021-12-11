import { parse, end } from 'iso8601-duration'
import { ForeignKeyViolationError, TransactionOrKnex } from 'objection'

import { CreateError } from './errors'
import { Grant } from './model'
import { RatesService } from '../../rates/service'
import { BaseService } from '../../shared/baseService'

export interface CreateOptions {
  accountId: string
  amount: bigint
  assetCode: string
  assetScale: number
  startAt?: Date
  expiresAt?: Date
  interval?: string
}

export interface GrantService {
  create(options: CreateOptions): Promise<Grant | CreateError>
  get(id: string): Promise<Grant | undefined>
  processNext(): Promise<string | undefined>
}

interface ServiceDependencies extends BaseService {
  knex: TransactionOrKnex
  ratesService: RatesService
}

export async function createGrantService(
  deps_: ServiceDependencies
): Promise<GrantService> {
  const log = deps_.logger.child({
    service: 'GrantService'
  })
  const deps: ServiceDependencies = {
    ...deps_,
    logger: log
  }
  return {
    create: (options) => createGrant(deps, options),
    get: (id) => getGrant(deps, id),
    processNext: () => processNextGrant(deps)
  }
}

async function createGrant(
  deps: ServiceDependencies,
  options: CreateOptions
): Promise<Grant | CreateError> {
  if (options.interval) {
    try {
      parse(options.interval)
    } catch (e) {
      return CreateError.InvalidInterval
    }
  }
  const now = new Date()
  if (options.expiresAt && options.expiresAt < now) {
    return CreateError.InvalidExpiresAt
  }
  const prices = await deps.ratesService.prices()
  if (!prices[options.assetCode]) {
    return CreateError.UnknownAsset
  }
  const prestart = options.startAt && now < options.startAt
  try {
    return await deps.knex.transaction(async (trx) => {
      const grant = await Grant.query(trx)
        .insertAndFetch({
          ...options,
          balance: prestart ? BigInt(0) : options.amount
        })
        .withGraphFetched('account.asset')

      // Patch processAt in order to use createdAt in getIntervalEnd
      await grant.$query(trx).patch({
        processAt: prestart ? options.startAt : getIntervalEnd(grant)
      })
      return grant
    })
  } catch (err) {
    if (err instanceof ForeignKeyViolationError) {
      return CreateError.UnknownAccount
    }
    throw err
  }
}

async function getGrant(
  deps: ServiceDependencies,
  id: string
): Promise<Grant | undefined> {
  return Grant.query(deps.knex).findById(id).withGraphJoined('account.asset')
}

// Start grant interval or deactivate expired grant.
// Returns the id of the processed grant (if any).
async function processNextGrant(
  deps: ServiceDependencies
): Promise<string | undefined> {
  return deps.knex.transaction(async (trx) => {
    const grants = await Grant.query(trx)
      .limit(1)
      // Ensure the grants cannot be processed concurrently by multiple workers.
      .forUpdate()
      // If a grant is locked, don't wait — just come back for it later.
      .skipLocked()
      .andWhere('processAt', '<=', new Date().toISOString())
    const grant = grants[0]
    if (!grant) return

    if (grant.expiresAt && grant.expiresAt <= new Date()) {
      deps.logger.trace({ grant: grant.id }, 'deactivating expired grant')
      await grant.$query(trx).patch({
        processAt: null,
        balance: BigInt(0)
      })
    } else {
      deps.logger.trace({ grant: grant.id }, 'starting grant interval')
      await grant.$query(trx).patch({
        processAt: getIntervalEnd(grant),
        balance: grant.amount
      })
    }

    return grant.id
  })
}

function getIntervalEnd(grant: Grant): Date | undefined {
  if (!grant.interval) {
    return grant.expiresAt
  } else {
    const intervalEnd = end(
      parse(grant.interval),
      grant.processAt || grant.startAt || grant.createdAt
    )
    if (grant.expiresAt && grant.expiresAt < intervalEnd) {
      return grant.expiresAt
    }
    return intervalEnd
  }
}
