import { ForeignKeyViolationError, NotFoundError, Transaction } from 'objection'
import { v4 as uuid } from 'uuid'

import { BalanceService } from '../balance/service'
import { BaseService } from '../shared/baseService'
import {
  BalanceTransferError,
  UnknownBalanceError,
  UnknownLiquidityAccountError
} from '../shared/errors'
import { Pagination } from '../shared/pagination'
import { TransferService, TwoPhaseTransfer } from '../transfer/service'
import { TransferError, TransfersError } from '../transfer/errors'
import { AccountError, AccountTransferError, UnknownAssetError } from './errors'
import { Account } from './model'

export { Account }

export type Options = {
  disabled?: boolean
  stream?: {
    enabled: boolean
  }
  maxPacketAmount?: bigint
}

type CreateAccountOptions = Options & {
  assetId: string
  sentBalance?: boolean
}

export type CreateOptions = CreateAccountOptions

export type UpdateOptions = Options & {
  id: string
}

export interface AccountTransferOptions {
  sourceAccount: Account
  destinationAccount: Account
  sourceAmount: bigint
  destinationAmount?: bigint
  timeout: bigint // nano-seconds
}

export interface AccountTransfer {
  commit: () => Promise<void | AccountTransferError>
  rollback: () => Promise<void | AccountTransferError>
}

export interface AccountService {
  create(account: CreateOptions, trx?: Transaction): Promise<Account>
  update(
    accountOptions: UpdateOptions,
    trx?: Transaction
  ): Promise<Account | AccountError>
  get(accountId: string): Promise<Account | undefined>
  getAccounts(ids: string[]): Promise<Account[]>
  getBalance(accountId: string): Promise<bigint | undefined>
  getTotalSent(accountId: string): Promise<bigint | undefined>
  getPage(pagination?: Pagination): Promise<Account[]>
  transferFunds(
    options: AccountTransferOptions
  ): Promise<AccountTransfer | AccountTransferError>
}

interface ServiceDependencies extends BaseService {
  balanceService: BalanceService
  transferService: TransferService
}

export function createAccountService({
  logger,
  knex,
  balanceService,
  transferService
}: ServiceDependencies): AccountService {
  const log = logger.child({
    service: 'AccountService'
  })
  const deps: ServiceDependencies = {
    logger: log,
    knex: knex,
    balanceService,
    transferService
  }
  return {
    create: (account, trx) => createAccount(deps, account, trx),
    update: (account, trx) => updateAccount(deps, account, trx),
    get: (id) => getAccount(deps, id),
    getAccounts: (ids) => getAccounts(deps, ids),
    getBalance: (id) => getAccountBalance(deps, id),
    getTotalSent: (id) => getAccountTotalSent(deps, id),
    getPage: (pagination?) => getAccountsPage(deps, pagination),
    transferFunds: (options) => transferFunds(deps, options)
  }
}

async function createAccount(
  deps: ServiceDependencies,
  account: CreateOptions,
  trx?: Transaction
): Promise<Account> {
  const acctTrx = trx || (await Account.startTransaction())
  try {
    const sentBalance = account.sentBalance
    delete account.sentBalance
    const accountRow = await Account.query(acctTrx)
      .insertAndFetch({
        assetId: account.assetId,
        balanceId: uuid(),
        disabled: account.disabled,
        maxPacketAmount: account.maxPacketAmount,
        stream: account.stream
      })
      .withGraphFetched('asset')

    const { id: balanceId } = await deps.balanceService.create({
      unit: accountRow.asset.unit
    })

    let sentBalanceId: string | undefined
    if (sentBalance) {
      sentBalanceId = (
        await deps.balanceService.create({
          unit: accountRow.asset.unit
        })
      ).id
    }
    const newAccount = await accountRow
      .$query(acctTrx)
      .patchAndFetch({
        balanceId,
        sentBalanceId
      })
      .withGraphFetched('asset')

    if (!trx) {
      await acctTrx.commit()
    }
    return newAccount
  } catch (err) {
    if (!trx) {
      await acctTrx.rollback()
    }
    if (
      err instanceof ForeignKeyViolationError &&
      err.constraint === 'accounts_assetid_foreign'
    ) {
      throw new UnknownAssetError(account.assetId)
    }
    throw err
  }
}

async function updateAccount(
  deps: ServiceDependencies,
  accountOptions: UpdateOptions,
  trx?: Transaction
): Promise<Account | AccountError> {
  const acctTrx = trx || (await Account.startTransaction(deps.knex))
  try {
    const account = await Account.query(acctTrx)
      .patchAndFetchById(accountOptions.id, accountOptions)
      .withGraphFetched('asset')
      .throwIfNotFound()
    if (!trx) {
      await acctTrx.commit()
    }
    return account
  } catch (err) {
    if (!trx) {
      await acctTrx.rollback()
    }
    if (err instanceof NotFoundError) {
      return AccountError.UnknownAccount
    }
    throw err
  }
}

async function getAccount(
  deps: ServiceDependencies,
  accountId: string
): Promise<Account | undefined> {
  const account = await Account.query(deps.knex)
    .findById(accountId)
    .withGraphJoined('asset')

  return account || undefined
}

async function getAccounts(
  deps: ServiceDependencies,
  ids: string[]
): Promise<Account[]> {
  return await Account.query(deps.knex).findByIds(ids).withGraphJoined('asset')
}

async function getAccountBalance(
  deps: ServiceDependencies,
  accountId: string
): Promise<bigint | undefined> {
  const account = await Account.query(deps.knex)
    .findById(accountId)
    .select('balanceId')

  if (!account) {
    return undefined
  }

  const balance = await deps.balanceService.get(account.balanceId)

  if (!balance) {
    throw new UnknownBalanceError(accountId)
  }

  return balance.balance
}

async function getAccountTotalSent(
  deps: ServiceDependencies,
  accountId: string
): Promise<bigint | undefined> {
  const account = await Account.query(deps.knex)
    .findById(accountId)
    .select('sentBalanceId')

  if (!account?.sentBalanceId) {
    return undefined
  }

  const balance = await deps.balanceService.get(account.sentBalanceId)

  if (!balance) {
    throw new UnknownBalanceError(accountId)
  }

  return balance.balance
}

async function transferFunds(
  deps: ServiceDependencies,
  {
    sourceAccount,
    destinationAccount,
    sourceAmount,
    destinationAmount,
    timeout
  }: AccountTransferOptions
): Promise<AccountTransfer | AccountTransferError> {
  if (sourceAccount.id === destinationAccount.id) {
    return AccountTransferError.SameAccounts
  }
  if (sourceAmount <= BigInt(0)) {
    return AccountTransferError.InvalidSourceAmount
  }
  if (destinationAmount !== undefined && destinationAmount <= BigInt(0)) {
    return AccountTransferError.InvalidDestinationAmount
  }
  const transfers: TwoPhaseTransfer[] = []

  // Same asset
  if (
    sourceAccount.asset.code === destinationAccount.asset.code &&
    sourceAccount.asset.scale === destinationAccount.asset.scale
  ) {
    transfers.push({
      id: uuid(),
      sourceBalanceId: sourceAccount.balanceId,
      destinationBalanceId: destinationAccount.balanceId,
      amount:
        destinationAmount && destinationAmount < sourceAmount
          ? destinationAmount
          : sourceAmount,
      timeout
    })
    // Same asset, different amounts
    if (destinationAmount && sourceAmount !== destinationAmount) {
      // Send excess source amount to liquidity account
      if (destinationAmount < sourceAmount) {
        transfers.push({
          id: uuid(),
          sourceBalanceId: sourceAccount.balanceId,
          destinationBalanceId: sourceAccount.asset.balanceId,
          amount: sourceAmount - destinationAmount,
          timeout
        })
        // Deliver excess destination amount from liquidity account
      } else {
        transfers.push({
          id: uuid(),
          sourceBalanceId: destinationAccount.asset.balanceId,
          destinationBalanceId: destinationAccount.balanceId,
          amount: destinationAmount - sourceAmount,
          timeout
        })
      }
    }
    // Different assets
  } else {
    // must specify destination amount
    if (!destinationAmount) {
      return AccountTransferError.InvalidDestinationAmount
    }
    // Send to source liquidity account
    // Deliver from destination liquidity account
    transfers.push(
      {
        id: uuid(),
        sourceBalanceId: sourceAccount.balanceId,
        destinationBalanceId: sourceAccount.asset.balanceId,
        amount: sourceAmount,
        timeout
      },
      {
        id: uuid(),
        sourceBalanceId: destinationAccount.asset.balanceId,
        destinationBalanceId: destinationAccount.balanceId,
        amount: destinationAmount,
        timeout
      }
    )
  }
  if (sourceAccount.sentBalanceId) {
    transfers.push({
      id: uuid(),
      sourceBalanceId: sourceAccount.asset.outgoingPaymentsBalanceId,
      destinationBalanceId: sourceAccount.sentBalanceId,
      amount: sourceAmount,
      timeout
    })
  }
  const error = await deps.transferService.create(transfers)
  if (error) {
    switch (error.error) {
      case TransferError.UnknownSourceBalance:
        if (error.index === 1) {
          throw new UnknownLiquidityAccountError(destinationAccount.asset)
        }
        throw new UnknownBalanceError(sourceAccount.balanceId)
      case TransferError.UnknownDestinationBalance:
        if (error.index === 1) {
          throw new UnknownBalanceError(destinationAccount.balanceId)
        }
        throw new UnknownLiquidityAccountError(sourceAccount.asset)
      case TransferError.InsufficientBalance:
        if (error.index === 1) {
          return AccountTransferError.InsufficientLiquidity
        }
        return AccountTransferError.InsufficientBalance
      default:
        throw new BalanceTransferError(error.error)
    }
  }

  const trx: AccountTransfer = {
    commit: async (): Promise<void | AccountTransferError> => {
      const error = await deps.transferService.commit(
        transfers.map((transfer) => transfer.id)
      )
      if (error) {
        return toAccountTransferError(error)
      }
    },
    rollback: async (): Promise<void | AccountTransferError> => {
      const error = await deps.transferService.rollback(
        transfers.map((transfer) => transfer.id)
      )
      if (error) {
        return toAccountTransferError(error)
      }
    }
  }
  return trx
}

function toAccountTransferError({
  error
}: TransfersError): AccountTransferError {
  switch (error) {
    case TransferError.TransferExpired:
      return AccountTransferError.TransferExpired
    case TransferError.AlreadyCommitted:
      return AccountTransferError.AlreadyCommitted
    case TransferError.AlreadyRolledBack:
      return AccountTransferError.AlreadyRolledBack
    default:
      throw new BalanceTransferError(error)
  }
}

/** TODO: Base64 encode/decode the cursors
 * Buffer.from("Hello World").toString('base64')
 * Buffer.from("SGVsbG8gV29ybGQ=", 'base64').toString('ascii')
 */

/** getAccountsPage
 * The pagination algorithm is based on the Relay connection specification.
 * Please read the spec before changing things:
 * https://relay.dev/graphql/connections.htm
 * @param pagination Pagination - cursors and limits.
 * @returns Account[] An array of accounts that form a page.
 */
async function getAccountsPage(
  deps: ServiceDependencies,
  pagination?: Pagination
): Promise<Account[]> {
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
    const accounts = await Account.query(deps.knex)
      .withGraphFetched('asset')
      .whereRaw(
        '("createdAt", "id") > (select "createdAt" :: TIMESTAMP, "id" from "accounts" where "id" = ?)',
        [pagination.after]
      )
      .orderBy([
        { column: 'createdAt', order: 'asc' },
        { column: 'id', order: 'asc' }
      ])
      .limit(first)
    return accounts
  }

  /**
   * Backward pagination
   */
  if (typeof pagination?.before === 'string') {
    const accounts = await Account.query(deps.knex)
      .withGraphFetched('asset')
      .whereRaw(
        '("createdAt", "id") < (select "createdAt" :: TIMESTAMP, "id" from "accounts" where "id" = ?)',
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
    return accounts
  }

  const accounts = await Account.query(deps.knex)
    .withGraphFetched('asset')
    .orderBy([
      { column: 'createdAt', order: 'asc' },
      { column: 'id', order: 'asc' }
    ])
    .limit(first)
  return accounts
}
