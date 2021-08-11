import { ResolversTypes, MutationResolvers } from '../generated/graphql'
import { isTransferError, Transfer } from '../../accounts/types'

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
    return {
      code: '400',
      message: 'Failed to transfer',
      success: false
    }
  }
  const error = await trxOrError.commit()
  if (error) {
    return {
      code: '400',
      message: 'Failed to commit transfer',
      success: false
    }
  }
  return {
    code: '200',
    success: true,
    message: 'Transfered funds'
  }
}
