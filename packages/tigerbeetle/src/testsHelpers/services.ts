import createLogger from 'pino'
import { createClient } from 'tigerbeetle-node'
import { createBalanceService, BalanceService } from '../balance/service'
import { createTransferService, TransferService } from '../transfer/service'

export interface TestServices {
  balanceService: BalanceService
  transferService: TransferService
  shutdown: () => void
}

export const createTestServices = (): TestServices => {
  const client = createClient({
    cluster_id: process.env.TIGERBEETLE_CLUSTER_ID
      ? parseInt(process.env.TIGERBEETLE_CLUSTER_ID)
      : 1,
    replica_addresses: process.env.TIGERBEETLE_REPLICA_ADDRESSES
      ? JSON.parse(process.env.TIGERBEETLE_REPLICA_ADDRESSES)
      : ['3001']
  })
  const logger = createLogger()

  const balanceService = createBalanceService({ client, logger })
  const transferService = createTransferService({ client, logger })

  return {
    balanceService,
    transferService,
    shutdown: () => {
      client.destroy()
    }
  }
}
