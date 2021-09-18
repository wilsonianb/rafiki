import Knex from 'knex'
import { TigerBeetleService, createTigerBeetleService } from 'tigerbeetle'
import { v4 as uuid } from 'uuid'

import { AccountService, createAccountService } from '../account/service'
import { AssetService, createAssetService } from '../asset/service'
import { createCreditService, CreditService } from '../credit/service'
import { createDepositService, DepositService } from '../deposit/service'
import { createHttpTokenService } from '../httpToken/service'
import { createTransferService, TransferService } from '../transfer/service'
import {
  createWithdrawalService,
  WithdrawalService
} from '../withdrawal/service'
import { Config } from '../config'
import { Logger } from '../logger/service'
import { createKnex } from '../Knex/service'

export interface TestServices {
  accountService: AccountService
  assetService: AssetService
  tigerbeetleService: TigerBeetleService
  creditService: CreditService
  depositService: DepositService
  transferService: TransferService
  withdrawalService: WithdrawalService
  config: typeof Config
  knex: Knex
  shutdown: () => Promise<void>
}

export const createTestServices = async (): Promise<TestServices> => {
  const config = Config
  config.ilpAddress = 'test.rafiki'
  config.peerAddresses = [
    {
      accountId: uuid(),
      ilpAddress: 'test.alice'
    }
  ]

  const knex = await createKnex(config.postgresUrl)
  const tigerbeetleService = createTigerBeetleService({
    clusterId: config.tigerbeetleClusterId,
    replicaAddresses: config.tigerbeetleReplicaAddresses
  })
  const assetService = createAssetService({
    tigerbeetleService,
    logger: Logger
  })
  const httpTokenService = await createHttpTokenService({ logger: Logger })
  const accountService = createAccountService({
    assetService,
    tigerbeetleService,
    httpTokenService,
    logger: Logger,
    ...config
  })
  const creditService = createCreditService({
    accountService,
    tigerbeetleService,
    logger: Logger
  })
  const depositService = createDepositService({
    accountService,
    assetService,
    tigerbeetleService,
    logger: Logger
  })
  const transferService = createTransferService({
    accountService,
    tigerbeetleService,
    logger: Logger
  })
  const withdrawalService = createWithdrawalService({
    accountService,
    assetService,
    tigerbeetleService,
    logger: Logger
  })

  return {
    accountService,
    assetService,
    tigerbeetleService,
    creditService,
    depositService,
    transferService,
    withdrawalService,
    config,
    knex,
    shutdown: async () => {
      await knex.destroy()
      tigerbeetleService.destroy()
    }
  }
}
