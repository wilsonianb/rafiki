import createLogger from 'pino'
import { createClient } from 'tigerbeetle-node'

import {
  Balance,
  BalanceOptions,
  CreateBalancesError,
  createBalanceService
} from './balance/service'
import {
  CommitTransfersError,
  CreateTransfersError,
  createTransferService,
  Transfer
} from './transfer/service'

export * from './balance/service'
export * from './transfer/service'

interface ServiceOptions {
  clusterId: number // u32
  replicaAddresses: Array<string | number>
}

export interface TigerBeetleService {
  createBalances(
    balances: BalanceOptions[]
  ): Promise<void | CreateBalancesError>
  getBalances(ids: string[]): Promise<Balance[]>
  createTransfers(transfers: Transfer[]): Promise<void | CreateTransfersError>
  commitTransfers(ids: string[]): Promise<void | CommitTransfersError>
  rollbackTransfers(ids: string[]): Promise<void | CommitTransfersError>
  destroy(): void
}

export function createTigerBeetleService({
  clusterId,
  replicaAddresses
}: ServiceOptions): TigerBeetleService {
  const client = createClient({
    cluster_id: clusterId,
    replica_addresses: replicaAddresses
  })
  const logger = createLogger()

  const balanceService = createBalanceService({ client, logger })
  const transferService = createTransferService({ client, logger })

  return {
    createBalances: (balances) => balanceService.create(balances),
    getBalances: (ids) => balanceService.get(ids),
    createTransfers: (transfers) => transferService.create(transfers),
    commitTransfers: (ids) => transferService.commit(ids),
    rollbackTransfers: (ids) => transferService.rollback(ids),
    destroy: () => client.destroy()
  }
}
