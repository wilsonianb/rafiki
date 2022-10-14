import { Transaction, TransactionOrKnex } from 'objection'

import { BaseService } from '../shared/baseService'
import { Access } from './model'
import { Access as AccessJSON } from './types'

export interface AccessService {
  createAccess(
    grantId: string,
    accesses: AccessJSON[],
    trx?: Transaction
  ): Promise<Access[]>
  getByGrant(grantId: string): Promise<Access[]>
}

interface ServiceDependencies extends BaseService {
  knex: TransactionOrKnex
}

export async function createAccessService({
  logger,
  knex
}: ServiceDependencies): Promise<AccessService> {
  const log = logger.child({
    service: 'AccessService'
  })

  const deps: ServiceDependencies = {
    logger: log,
    knex
  }

  return {
    createAccess: (grantId, accesses, trx) =>
      createAccess(deps, grantId, accesses, trx),
    getByGrant: (grantId) => getByGrant(grantId)
  }
}

async function createAccess(
  deps: ServiceDependencies,
  grantId: string,
  accesses: AccessJSON[],
  trx?: Transaction
): Promise<Access[]> {
  const accessRequestsWithGrant = accesses.map((access) => {
    return { grantId, ...access }
  })

  return Access.query(trx || deps.knex).insert(accessRequestsWithGrant)
}

async function getByGrant(grantId: string): Promise<Access[]> {
  return Access.query().where({
    grantId
  })
}
