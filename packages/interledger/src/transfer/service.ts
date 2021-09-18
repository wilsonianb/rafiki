import {
  TigerBeetleService,
  CommitTransferError,
  CreateTransferError,
  TwoPhaseTransfer
} from 'tigerbeetle'
import { v4 as uuid } from 'uuid'
import { AccountService } from '../account/service'
import { BaseService } from '../shared/baseService'
import {
  BalanceTransferError,
  UnknownBalanceError,
  UnknownLiquidityAccountError
} from '../shared/errors'

export interface Transfer {
  sourceAccountId: string
  destinationAccountId: string

  sourceAmount: bigint
  destinationAmount?: bigint
}

export interface Transaction {
  commit: () => Promise<void | TransferError>
  rollback: () => Promise<void | TransferError>
}

export enum TransferError {
  InsufficientBalance = 'InsufficientBalance',
  InsufficientLiquidity = 'InsufficientLiquidity',
  InvalidSourceAmount = 'InvalidSourceAmount',
  InvalidDestinationAmount = 'InvalidDestinationAmount',
  SameAccounts = 'SameAccounts',
  TransferAlreadyCommitted = 'TransferAlreadyCommitted',
  TransferAlreadyRejected = 'TransferAlreadyRejected',
  TransferExpired = 'TransferExpired',
  UnknownSourceAccount = 'UnknownSourceAccount',
  UnknownDestinationAccount = 'UnknownDestinationAccount'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isTransferError = (o: any): o is TransferError =>
  Object.values(TransferError).includes(o)

export interface TransferService {
  create(transfer: Transfer): Promise<Transaction | TransferError>
  // get(id: string): Promise<void | TransferError>
}

interface ServiceDependencies extends BaseService {
  accountService: AccountService
  tigerbeetleService: TigerBeetleService
}

export function createTransferService({
  logger,
  accountService,
  tigerbeetleService
}: ServiceDependencies): TransferService {
  const log = logger.child({
    service: 'TransferService'
  })
  const deps: ServiceDependencies = {
    logger: log,
    accountService,
    tigerbeetleService
  }
  return {
    create: (transfer) => createTransfer(deps, transfer)
    // get: (id) => getTransfer(deps, id)
  }
}

async function createTransfer(
  deps: ServiceDependencies,
  {
    sourceAccountId,
    destinationAccountId,
    sourceAmount,
    destinationAmount
  }: Transfer
): Promise<Transaction | TransferError> {
  if (sourceAccountId === destinationAccountId) {
    return TransferError.SameAccounts
  }
  if (sourceAmount <= BigInt(0)) {
    return TransferError.InvalidSourceAmount
  }
  if (destinationAmount !== undefined && destinationAmount <= BigInt(0)) {
    return TransferError.InvalidDestinationAmount
  }
  const accounts = await deps.accountService.getAccounts([
    sourceAccountId,
    destinationAccountId
  ])
  if (accounts.length !== 2) {
    if (accounts.length === 0 || accounts[0].id !== sourceAccountId) {
      return TransferError.UnknownSourceAccount
    } else {
      return TransferError.UnknownDestinationAccount
    }
  }
  const sourceAccount =
    accounts[0].id === sourceAccountId ? accounts[0] : accounts[1]
  const destinationAccount =
    accounts[0].id === destinationAccountId ? accounts[0] : accounts[1]

  const transfers: TwoPhaseTransfer[] = []

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
      twoPhaseCommit: true
    })
    if (destinationAmount && sourceAmount !== destinationAmount) {
      if (destinationAmount < sourceAmount) {
        transfers.push({
          id: uuid(),
          sourceBalanceId: sourceAccount.balanceId,
          destinationBalanceId: sourceAccount.asset.liquidityBalanceId,
          amount: sourceAmount - destinationAmount,
          twoPhaseCommit: true
        })
      } else {
        transfers.push({
          id: uuid(),
          sourceBalanceId: destinationAccount.asset.liquidityBalanceId,
          destinationBalanceId: destinationAccount.balanceId,
          amount: destinationAmount - sourceAmount,
          twoPhaseCommit: true
        })
      }
    }
  } else {
    if (!destinationAmount) {
      return TransferError.InvalidDestinationAmount
    }
    transfers.push(
      {
        id: uuid(),
        sourceBalanceId: sourceAccount.balanceId,
        destinationBalanceId: sourceAccount.asset.liquidityBalanceId,
        amount: sourceAmount,
        twoPhaseCommit: true
      },
      {
        id: uuid(),
        sourceBalanceId: destinationAccount.asset.liquidityBalanceId,
        destinationBalanceId: destinationAccount.balanceId,
        amount: destinationAmount,
        twoPhaseCommit: true
      }
    )
  }
  const error = await deps.tigerbeetleService.createTransfers(transfers)
  if (error) {
    switch (error.code) {
      case CreateTransferError.debit_account_not_found:
        if (error.index === 1) {
          throw new UnknownLiquidityAccountError(destinationAccount.asset)
        }
        throw new UnknownBalanceError(sourceAccountId)
      case CreateTransferError.credit_account_not_found:
        if (error.index === 1) {
          throw new UnknownBalanceError(destinationAccountId)
        }
        throw new UnknownLiquidityAccountError(sourceAccount.asset)
      case CreateTransferError.exceeds_credits:
        if (error.index === 1) {
          return TransferError.InsufficientLiquidity
        }
        return TransferError.InsufficientBalance
      default:
        throw new BalanceTransferError(error.code)
    }
  }

  const trx: Transaction = {
    commit: async (): Promise<void | TransferError> => {
      const error = await deps.tigerbeetleService.commitTransfers(
        transfers.map((transfer) => transfer.id)
      )
      if (error) {
        switch (error.code) {
          case CommitTransferError.linked_event_failed:
            break
          case CommitTransferError.transfer_expired:
            return TransferError.TransferExpired
          case CommitTransferError.already_committed:
            return TransferError.TransferAlreadyCommitted
          case CommitTransferError.already_committed_but_rejected:
            return TransferError.TransferAlreadyRejected
          default:
            throw new BalanceTransferError(error.code)
        }
      }
    },
    rollback: async (): Promise<void | TransferError> => {
      const error = await deps.tigerbeetleService.rollbackTransfers(
        transfers.map((transfer) => transfer.id)
      )
      if (error) {
        switch (error.code) {
          case CommitTransferError.linked_event_failed:
            break
          case CommitTransferError.transfer_expired:
            return TransferError.TransferExpired
          case CommitTransferError.already_committed_but_accepted:
            return TransferError.TransferAlreadyCommitted
          case CommitTransferError.already_committed:
            return TransferError.TransferAlreadyRejected
          default:
            throw new BalanceTransferError(error.code)
        }
      }
    }
  }
  return trx
}
