import assert from 'assert'
import {
  Client,
  CreateAccountError as CreateAccountErrorCode
} from 'tigerbeetle-node'
import { v4 as uuid } from 'uuid'

import {
  AccountType,
  calculateBalance,
  createAccounts,
  getAccounts
} from './accounts'
import {
  BalanceTransferError,
  CreateAccountError,
  TransferError,
  UnknownAccountError
} from './errors'
import {
  CreateTransferOptions,
  createTransfers,
  commitTransfers,
  rollbackTransfers,
  TransferCode
} from './transfers'
import { AccountIdOptions, AssetAccount } from './utils'
import { BaseService } from '../shared/baseService'
import { validateId } from '../shared/utils'

export interface Account {
  id: string
  balance: bigint
  asset: {
    unit: number
  }
}

export type AccountOptions = Omit<Account, 'balance'>

interface AccountOption {
  accountId: string
  asset?: never
}

interface AssetOption {
  accountId?: never
  asset: {
    unit: number
  }
}

export type Deposit = (AccountOption | AssetOption) & {
  id: string
  amount: bigint
}

export type Withdrawal = Deposit & {
  timeout: bigint
}

export interface TransferOptions {
  sourceAccount: AccountOptions
  destinationAccount: AccountOptions
  sourceAmount: bigint
  destinationAmount?: bigint
  timeout: bigint // nano-seconds
}

export interface Transaction {
  commit: () => Promise<void | TransferError>
  rollback: () => Promise<void | TransferError>
}

export interface AccountingService {
  createAccount(options: AccountOptions): Promise<Account>
  createAssetAccounts(unit: number): Promise<void>
  getAccount(id: string): Promise<Account | undefined>
  getBalance(id: string): Promise<bigint | undefined>
  getTotalSent(id: string): Promise<bigint | undefined>
  getTotalReceived(id: string): Promise<bigint | undefined>
  getAssetLiquidityBalance(unit: number): Promise<bigint | undefined>
  getAssetSettlementBalance(unit: number): Promise<bigint | undefined>
  createTransfer(options: TransferOptions): Promise<Transaction | TransferError>
  createDeposit(deposit: Deposit): Promise<void | TransferError>
  createWithdrawal(withdrawal: Withdrawal): Promise<void | TransferError>
  commitWithdrawal(id: string): Promise<void | TransferError>
  rollbackWithdrawal(id: string): Promise<void | TransferError>
}

export interface ServiceDependencies extends BaseService {
  tigerbeetle: Client
}

export function createAccountingService({
  logger,
  knex,
  tigerbeetle
}: ServiceDependencies): AccountingService {
  const log = logger.child({
    service: 'AccountingService'
  })
  const deps: ServiceDependencies = {
    logger: log,
    knex: knex,
    tigerbeetle
  }
  return {
    createAccount: (options) => createAccount(deps, options),
    createAssetAccounts: (unit) => createAssetAccounts(deps, unit),
    getAccount: (id) => getAccount(deps, id),
    getBalance: (id) => getAccountBalance(deps, id),
    getTotalSent: (id) => getAccountTotalSent(deps, id),
    getTotalReceived: (id) => getAccountTotalReceived(deps, id),
    getAssetLiquidityBalance: (unit) => getAssetLiquidityBalance(deps, unit),
    getAssetSettlementBalance: (unit) => getAssetSettlementBalance(deps, unit),
    createTransfer: (options) => createTransfer(deps, options),
    createDeposit: (transfer) => createAccountDeposit(deps, transfer),
    createWithdrawal: (transfer) => createAccountWithdrawal(deps, transfer),
    commitWithdrawal: (options) => commitAccountWithdrawal(deps, options),
    rollbackWithdrawal: (options) => rollbackAccountWithdrawal(deps, options)
  }
}

export async function createAccount(
  deps: ServiceDependencies,
  options: AccountOptions
): Promise<Account> {
  if (!validateId(options.id)) {
    throw new Error('unable to create account, invalid id')
  }

  await createAccounts(deps, [
    {
      id: options.id,
      type: AccountType.Credit,
      unit: options.asset.unit
    }
  ])
  return {
    ...options,
    balance: BigInt(0)
  }
}

export async function createAssetAccounts(
  deps: ServiceDependencies,
  unit: number
): Promise<void> {
  const accounts = [
    {
      asset: {
        unit,
        account: AssetAccount.Liquidity
      },
      type: AccountType.Credit,
      unit
    },
    {
      asset: {
        unit,
        account: AssetAccount.Settlement
      },
      type: AccountType.Debit,
      unit
    }
  ]

  try {
    await createAccounts(deps, accounts)
  } catch (err) {
    // Don't complain if asset accounts already exist.
    // This could change if TigerBeetle could be reset between tests.
    if (
      err instanceof CreateAccountError &&
      err.code === CreateAccountErrorCode.exists
    ) {
      return
    }
    throw err
  }
}

export async function getAccount(
  deps: ServiceDependencies,
  id: string
): Promise<Account | undefined> {
  const accounts = await getAccounts(deps, [
    {
      id
    }
  ])

  if (accounts.length) {
    const account = accounts[0]
    return {
      id,
      asset: {
        unit: account.unit
      },
      balance: calculateBalance(account)
    }
  }
}

export async function getAccountBalance(
  deps: ServiceDependencies,
  id: string
): Promise<bigint | undefined> {
  const account = (await getAccounts(deps, [{ id }]))[0]
  if (account) {
    return calculateBalance(account)
  }
}

export async function getAccountTotalSent(
  deps: ServiceDependencies,
  id: string
): Promise<bigint | undefined> {
  const account = (await getAccounts(deps, [{ id }]))[0]
  if (account) {
    return account.debits_accepted
  }
}

export async function getAccountTotalReceived(
  deps: ServiceDependencies,
  id: string
): Promise<bigint | undefined> {
  const account = (await getAccounts(deps, [{ id }]))[0]
  if (account) {
    return account.credits_accepted
  }
}

export async function getAssetLiquidityBalance(
  deps: ServiceDependencies,
  unit: number
): Promise<bigint | undefined> {
  const assetAccount = (
    await getAccounts(deps, [
      { asset: { unit, account: AssetAccount.Liquidity } }
    ])
  )[0]

  if (assetAccount) {
    return calculateBalance(assetAccount)
  }
}

export async function getAssetSettlementBalance(
  deps: ServiceDependencies,
  unit: number
): Promise<bigint | undefined> {
  const assetAccount = (
    await getAccounts(deps, [
      { asset: { unit, account: AssetAccount.Settlement } }
    ])
  )[0]

  if (assetAccount) {
    return calculateBalance(assetAccount)
  }
}

export async function createTransfer(
  deps: ServiceDependencies,
  {
    sourceAccount,
    destinationAccount,
    sourceAmount,
    destinationAmount,
    timeout
  }: TransferOptions
): Promise<Transaction | TransferError> {
  if (sourceAccount.id === destinationAccount.id) {
    return TransferError.SameAccounts
  }
  if (sourceAmount <= BigInt(0)) {
    return TransferError.InvalidSourceAmount
  }
  if (destinationAmount !== undefined && destinationAmount <= BigInt(0)) {
    return TransferError.InvalidDestinationAmount
  }
  const transfers: Required<CreateTransferOptions>[] = []

  const addTransfer = ({
    sourceAccount,
    destinationAccount,
    amount
  }: {
    sourceAccount: AccountIdOptions
    destinationAccount: AccountIdOptions
    amount: bigint
  }) => {
    transfers.push({
      id: uuid(),
      sourceAccount,
      destinationAccount,
      amount,
      code: TransferCode.Transfer,
      timeout
    })
  }

  // Same asset
  if (sourceAccount.asset.unit === destinationAccount.asset.unit) {
    addTransfer({
      sourceAccount,
      destinationAccount,
      amount:
        destinationAmount && destinationAmount < sourceAmount
          ? destinationAmount
          : sourceAmount
    })
    // Same asset, different amounts
    if (destinationAmount && sourceAmount !== destinationAmount) {
      // Send excess source amount to liquidity account
      if (destinationAmount < sourceAmount) {
        addTransfer({
          sourceAccount,
          destinationAccount: {
            asset: {
              unit: sourceAccount.asset.unit,
              account: AssetAccount.Liquidity
            }
          },
          amount: sourceAmount - destinationAmount
        })
        // Deliver excess destination amount from liquidity account
      } else {
        addTransfer({
          sourceAccount: {
            asset: {
              unit: destinationAccount.asset.unit,
              account: AssetAccount.Liquidity
            }
          },
          destinationAccount,
          amount: destinationAmount - sourceAmount
        })
      }
    }
    // Different assets
  } else {
    // must specify destination amount
    if (!destinationAmount) {
      return TransferError.InvalidDestinationAmount
    }
    // Send to source liquidity account
    // Deliver from destination liquidity account
    addTransfer({
      sourceAccount,
      destinationAccount: {
        asset: {
          unit: sourceAccount.asset.unit,
          account: AssetAccount.Liquidity
        }
      },
      amount: sourceAmount
    })
    addTransfer({
      sourceAccount: {
        asset: {
          unit: destinationAccount.asset.unit,
          account: AssetAccount.Liquidity
        }
      },
      destinationAccount,
      amount: destinationAmount
    })
  }
  const error = await createTransfers(deps, transfers)
  if (error) {
    switch (error.error) {
      case TransferError.UnknownSourceAccount:
        throw new UnknownAccountError(transfers[error.index].sourceAccount)
      case TransferError.UnknownDestinationAccount:
        throw new UnknownAccountError(transfers[error.index].destinationAccount)
      case TransferError.InsufficientBalance:
        if (
          transfers[error.index].sourceAccount.asset?.account ===
          AssetAccount.Liquidity
        ) {
          return TransferError.InsufficientLiquidity
        }
        return TransferError.InsufficientBalance
      default:
        throw new BalanceTransferError(error.error)
    }
  }

  const trx: Transaction = {
    commit: async (): Promise<void | TransferError> => {
      const error = await commitTransfers(
        deps,
        transfers.map((transfer) => transfer.id)
      )
      if (error) {
        return error.error
      }
    },
    rollback: async (): Promise<void | TransferError> => {
      const error = await rollbackTransfers(
        deps,
        transfers.map((transfer) => transfer.id)
      )
      if (error) {
        return error.error
      }
    }
  }
  return trx
}

async function createAccountDeposit(
  deps: ServiceDependencies,
  { id, accountId, asset, amount }: Deposit
): Promise<void | TransferError> {
  if (!validateId(id)) {
    return TransferError.InvalidId
  }
  let destinationAccount: AccountIdOptions
  let unit: number
  if (accountId) {
    const account = await getAccount(deps, accountId)
    if (!account) {
      return TransferError.UnknownDestinationAccount
    }
    destinationAccount = account
    unit = account.asset.unit
  } else {
    assert.ok(asset)
    destinationAccount = {
      asset: {
        unit: asset.unit,
        account: AssetAccount.Liquidity
      }
    }
    unit = asset.unit
  }
  const error = await createTransfers(deps, [
    {
      id,
      sourceAccount: {
        asset: {
          unit,
          account: AssetAccount.Settlement
        }
      },
      destinationAccount,
      amount,
      code: TransferCode.Deposit
    }
  ])
  if (error) {
    return error.error
  }
}

async function createAccountWithdrawal(
  deps: ServiceDependencies,
  { id, accountId, asset, amount, timeout }: Withdrawal
): Promise<void | TransferError> {
  if (!validateId(id)) {
    return TransferError.InvalidId
  }
  let sourceAccount: AccountIdOptions
  let unit: number
  if (accountId) {
    const account = await getAccount(deps, accountId)
    if (!account) {
      return TransferError.UnknownDestinationAccount
    }
    sourceAccount = account
    unit = account.asset.unit
  } else {
    assert.ok(asset)
    sourceAccount = {
      asset: {
        unit: asset.unit,
        account: AssetAccount.Liquidity
      }
    }
    unit = asset.unit
  }
  const error = await createTransfers(deps, [
    {
      id,
      sourceAccount,
      destinationAccount: {
        asset: {
          unit,
          account: AssetAccount.Settlement
        }
      },
      amount,
      code: TransferCode.Withdrawal,
      timeout
    }
  ])
  if (error) {
    return error.error
  }
}

async function rollbackAccountWithdrawal(
  deps: ServiceDependencies,
  withdrawalId: string
): Promise<void | TransferError> {
  if (!validateId(withdrawalId)) {
    return TransferError.InvalidId
  }
  const error = await rollbackTransfers(deps, [withdrawalId])
  if (error) {
    return error.error
  }
}

async function commitAccountWithdrawal(
  deps: ServiceDependencies,
  withdrawalId: string
): Promise<void | TransferError> {
  if (!validateId(withdrawalId)) {
    return TransferError.InvalidId
  }
  const error = await commitTransfers(deps, [withdrawalId])
  if (error) {
    return error.error
  }
}
