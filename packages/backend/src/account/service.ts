import { ForeignKeyViolationError, Transaction } from 'objection'
import { v4 as uuid } from 'uuid'

import { BalanceService } from '../balance/service'
import { BaseService } from '../shared/baseService'
import {
  BalanceTransferError,
  UnknownBalanceError,
  UnknownLiquidityAccountError
} from '../shared/errors'
import { TransferService, TwoPhaseTransfer } from '../transfer/service'
import { TransferError, TransfersError } from '../transfer/errors'
import { AccountTransferError, UnknownAssetError } from './errors'
import { Account } from './model'

export { Account }

export interface CreateOptions {
  disabled?: boolean
  assetId: string
  sentBalance?: boolean
  debitBalance?: boolean
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
  get(accountId: string): Promise<Account | undefined>
  getBalance(accountId: string): Promise<bigint | undefined>
  getTotalSent(accountId: string): Promise<bigint | undefined>
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
    get: (id) => getAccount(deps, id),
    getBalance: (id) => getAccountBalance(deps, id),
    getTotalSent: (id) => getAccountTotalSent(deps, id),
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
    const debitBalance = account.debitBalance
    delete account.sentBalance
    delete account.debitBalance
    const accountRow = await Account.query(acctTrx)
      .insertAndFetch({
        assetId: account.assetId,
        balanceId: uuid(),
        disabled: account.disabled
      })
      .withGraphFetched('asset')

    const { id: balanceId } = await deps.balanceService.create({
      unit: accountRow.asset.unit,
      debitBalance
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
      .withGraphFetched(Account.graph)

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

async function getAccount(
  deps: ServiceDependencies,
  accountId: string
): Promise<Account | undefined> {
  const account = await Account.query(deps.knex)
    .findById(accountId)
    .withGraphJoined(Account.graph)

  return account || undefined
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
          destinationBalanceId: sourceAccount.asset.liquidityAccount.balanceId,
          amount: sourceAmount - destinationAmount,
          timeout
        })
        // Deliver excess destination amount from liquidity account
      } else {
        transfers.push({
          id: uuid(),
          sourceBalanceId: destinationAccount.asset.liquidityAccount.balanceId,
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
        destinationBalanceId: sourceAccount.asset.liquidityAccount.balanceId,
        amount: sourceAmount,
        timeout
      },
      {
        id: uuid(),
        sourceBalanceId: destinationAccount.asset.liquidityAccount.balanceId,
        destinationBalanceId: destinationAccount.balanceId,
        amount: destinationAmount,
        timeout
      }
    )
  }
  if (sourceAccount.sentBalanceId) {
    transfers.push({
      id: uuid(),
      sourceBalanceId: sourceAccount.asset.sentAccount.balanceId,
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
