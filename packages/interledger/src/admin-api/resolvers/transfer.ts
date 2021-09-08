import {
  ResolversTypes,
  MutationResolvers,
  TransferError as TransferErrorResp
} from '../generated/graphql'
import { isTransferError, Transfer, TransferError } from '../../accounts/types'

export const transfer: MutationResolvers['transfer'] = async (
  parent,
  args,
  ctx
): ResolversTypes['TransferMutationResponse'] => {
  // TODO: support auto-commit and idempotency key
  const transfer: Transfer = {
    sourceAccountId: args.input.sourceAccountId,
    destinationAccountId: args.input.destinationAccountId,
    sourceAmount: BigInt(args.input.sourceAmount)
  }
  if (args.input.destinationAmount) {
    transfer.destinationAmount = BigInt(args.input.destinationAmount)
  }
  const trxOrError = await ctx.accountsService.transferFunds(transfer)
  if (isTransferError(trxOrError)) {
    return errorToResponse[trxOrError]
  }
  const error = await trxOrError.commit()
  if (error) {
    return errorToResponse[error]
  }
  return {
    code: '200',
    success: true,
    message: 'Transferred funds'
  }
}

const errorToResponse: {
  [key in TransferError]: {
    code: string
    message: string
    success: boolean
    error: TransferErrorResp
  }
} = {
  [TransferError.InsufficientBalance]: {
    code: '403',
    message: 'Insufficient balance',
    success: false,
    error: TransferErrorResp.InsufficientBalance
  },
  [TransferError.InsufficientLiquidity]: {
    code: '403',
    message: 'Insufficient liquidity',
    success: false,
    error: TransferErrorResp.InsufficientLiquidity
  },
  [TransferError.InvalidSourceAmount]: {
    code: '400',
    message: 'Invalid source amount',
    success: false,
    error: TransferErrorResp.InvalidSourceAmount
  },
  [TransferError.InvalidDestinationAmount]: {
    code: '400',
    message: 'Invalid destination amount',
    success: false,
    error: TransferErrorResp.InvalidDestinationAmount
  },
  [TransferError.SameAccounts]: {
    code: '400',
    message: 'Same accounts',
    success: false,
    error: TransferErrorResp.SameAccounts
  },
  [TransferError.TransferAlreadyCommitted]: {
    code: '409',
    message: 'Transfer already committed',
    success: false,
    error: TransferErrorResp.TransferAlreadyCommitted
  },
  [TransferError.TransferAlreadyRejected]: {
    code: '409',
    message: 'Transfer already rejected',
    success: false,
    error: TransferErrorResp.TransferAlreadyRejected
  },
  [TransferError.TransferExpired]: {
    code: '403',
    message: 'Transfer expired',
    success: false,
    error: TransferErrorResp.TransferExpired
  },
  [TransferError.UnknownSourceAccount]: {
    code: '404',
    message: 'Unknown source account',
    success: false,
    error: TransferErrorResp.UnknownSourceAccount
  },
  [TransferError.UnknownDestinationAccount]: {
    code: '404',
    message: 'Unknown destination account',
    success: false,
    error: TransferErrorResp.UnknownDestinationAccount
  }
}
