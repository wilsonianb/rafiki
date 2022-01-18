import assert from 'assert'
import { end, parse, toSeconds } from 'iso8601-duration'
import { TransactionOrKnex } from 'objection'

import { CreateError } from './errors'
import { Grant } from './model'
import { BaseService } from '../../shared/baseService'

export interface NonRecurringOptions {
  startAt?: never
  interval?: never
}

export interface RecurringOptions {
  startAt: Date
  interval: string
}

export type CreateOptions = (NonRecurringOptions | RecurringOptions) & {
  id: string
  amount: bigint
  assetCode: string
  assetScale: number
}

export interface GrantService {
  create(options: CreateOptions): Promise<Grant | CreateError>
  get(id: string): Promise<Grant | undefined>
  processNext(): Promise<string | undefined>
}

interface ServiceDependencies extends BaseService {
  knex: TransactionOrKnex
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
  let intervalEnd: Date | undefined
  if (options.interval) {
    try {
      // Don't assume grant is created during the first interval
      const msSinceStart = Date.now() - options.startAt.getTime()
      if (msSinceStart < 0) {
        return CreateError.InvalidStartAt
      }
      const duration = parse(options.interval)
      const durationMs = toSeconds(duration) * 1000
      const currentIntervalIdx = Math.floor(msSinceStart / durationMs)
      const intervalStart =
        options.startAt.getTime() + durationMs * currentIntervalIdx
      intervalEnd = end(duration, new Date(intervalStart))
    } catch (e) {
      return CreateError.InvalidInterval
    }
  }
  return await Grant.query(deps.knex).insertAndFetch({
    id: options.id,
    amount: options.amount,
    assetCode: options.assetCode,
    assetScale: options.assetScale,
    interval: options.interval,
    balance: options.amount,
    intervalEnd
  })
}

async function getGrant(
  deps: ServiceDependencies,
  id: string
): Promise<Grant | undefined> {
  return Grant.query(deps.knex).findById(id)
}

// Start new grant interval.
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
      .andWhere('intervalEnd', '<=', new Date().toISOString())
    const grant = grants[0]
    if (!grant) return

    assert.ok(grant.intervalEnd)

    if (!grant.interval) {
      deps.logger.warn({ grant: grant.id }, 'processing non-recurring interval')
      await grant.$query(trx).patch({
        intervalEnd: null
      })
      return
    } else {
      deps.logger.trace({ grant: grant.id }, 'starting grant interval')
      await grant.$query(trx).patch({
        balance: grant.amount,
        intervalEnd: end(parse(grant.interval), grant.intervalEnd)
      })
    }
    return grant.id
  })
}
