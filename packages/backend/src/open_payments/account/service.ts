import assert from 'assert'
import { TransactionOrKnex } from 'objection'
import { v4 as uuid } from 'uuid'

import { Account } from './model'
import { BaseService } from '../../shared/baseService'
import { AccountingService } from '../../accounting/service'
import { AssetService, AssetOptions } from '../../asset/service'
import { EventType, WebhookService } from '../../webhook/service'

// First retry waits 10 seconds
// Second retry waits 20 (more) seconds
// Third retry waits 30 (more) seconds, etc. up to 60 seconds
export const RETRY_BACKOFF_MS = 10_000

export interface CreateOptions {
  asset: AssetOptions
  balanceWithdrawalThreshold?: bigint
}

export interface AccountService {
  create(options: CreateOptions): Promise<Account>
  get(id: string): Promise<Account | undefined>
  processNext(): Promise<string | undefined>
}

interface ServiceDependencies extends BaseService {
  knex: TransactionOrKnex
  accountingService: AccountingService
  assetService: AssetService
  webhookService: WebhookService
}

export async function createAccountService(
  deps_: ServiceDependencies
): Promise<AccountService> {
  const log = deps_.logger.child({
    service: 'AccountService'
  })
  const deps: ServiceDependencies = {
    ...deps_,
    logger: log
  }
  return {
    create: (options) => createAccount(deps, options),
    get: (id) => getAccount(deps, id),
    processNext: () => processNextAccount(deps)
  }
}

async function createAccount(
  deps: ServiceDependencies,
  options: CreateOptions
): Promise<Account> {
  const asset = await deps.assetService.getOrCreate(options.asset)
  return await Account.transaction(deps.knex, async (trx) => {
    const account = await Account.query(trx)
      .insertAndFetch({
        assetId: asset.id,
        balanceWithdrawalThreshold: options.balanceWithdrawalThreshold
      })
      .withGraphFetched('asset')

    // SPSP fallback account
    await deps.accountingService.createAccount({
      id: account.id,
      asset: account.asset
    })

    return account
  })
}

async function getAccount(
  deps: ServiceDependencies,
  id: string
): Promise<Account | undefined> {
  return await Account.query(deps.knex).findById(id).withGraphJoined('asset')
}

// Fetch (and lock) an invoice for work.
// Returns the id of the processed invoice (if any).
async function processNextAccount(
  deps_: ServiceDependencies
): Promise<string | undefined> {
  return deps_.knex.transaction(async (trx) => {
    const now = new Date(Date.now()).toISOString()
    const accounts = await Account.query(trx)
      .limit(1)
      // Ensure the accounts cannot be processed concurrently by multiple workers.
      .forUpdate()
      // If an invoice is locked, don't wait — just come back for it later.
      .skipLocked()
      .where('processAt', '<=', now)

    const account = accounts[0]
    if (!account) return
    assert.ok(account.processAt)

    const deps = {
      ...deps_,
      knex: trx,
      logger: deps_.logger.child({
        account: account.id
      })
    }

    if (!account.withdrawal) {
      deps.logger.warn(
        { withdrawal: account.withdrawal },
        'account with processAt and no withdrawal'
      )
      await account.$query(deps.knex).patch({ processAt: null })
      return
    }

    try {
      deps.logger.trace(
        { amount: account.withdrawal.amount },
        'withdrawing account balance'
      )
      const error = await deps.accountingService.createWithdrawal({
        id: account.withdrawal.transferId,
        accountId: account.id,
        amount: account.withdrawal.amount,
        timeout: BigInt(deps.webhookService.timeout) * BigInt(1e6) // ms -> ns
      })
      if (error) throw error

      const { status } = await deps.webhookService.send({
        id: account.withdrawal.id,
        type: EventType.AccountWebMonetization,
        account,
        balance: account.withdrawal.amount
      })
      const err = await deps.accountingService.commitWithdrawal(
        account.withdrawal.transferId
      )
      if (err) throw err
      if (status === 200) {
        // Check if balance already exceeds withdrawal threshold
        const balance = await deps.accountingService.getBalance(account.id)
        assert.ok(balance !== undefined)
        if (
          account.balanceWithdrawalThreshold &&
          account.balanceWithdrawalThreshold <= balance
        ) {
          await account.$query(deps.knex).patch({
            processAt: new Date(),
            withdrawal: {
              id: uuid(),
              amount: balance,
              attempts: 0,
              transferId: uuid()
            }
          })
        } else {
          await account.$query(deps.knex).patch({
            processAt: null,
            withdrawal: null
          })
        }
      }
    } catch (error) {
      const attempts = account.withdrawal?.attempts + 1
      deps.logger.warn(
        { error, attempts },
        'withdrawal attempt failed; retrying'
      )
      await deps.accountingService.rollbackWithdrawal(
        account.withdrawal.transferId
      )

      const processAt = new Date(
        account.processAt.getTime() + Math.min(attempts, 6) * RETRY_BACKOFF_MS
      )
      await account.$query(deps.knex).patch({
        processAt,
        withdrawal: {
          ...account.withdrawal,
          attempts,
          transferId: uuid()
        }
      })
    }
    return account.id
  })
}
