import { Errors } from 'ilp-packet'
import { ILPContext, ILPMiddleware } from '../rafiki'
import {
  isAccountTransferError,
  AccountTransferError
} from '../../../account/errors'
const { InsufficientLiquidityError } = Errors

export function createBalanceMiddleware(): ILPMiddleware {
  return async (
    { request, response, services, accounts, throw: ctxThrow }: ILPContext,
    next: () => Promise<void>
  ): Promise<void> => {
    const { amount } = request.prepare

    // Ignore zero amount packets
    if (amount === '0') {
      await next()
      return
    }

    const sourceAmount = BigInt(amount)
    const destinationAmountOrError = await services.rates.convert({
      sourceAmount,
      sourceAsset: accounts.incoming.asset,
      destinationAsset: accounts.outgoing.asset
    })
    if (typeof destinationAmountOrError !== 'bigint') {
      // ConvertError
      throw new Errors.CannotReceiveError(
        `Exchange rate error: ${destinationAmountOrError}`
      )
    }

    request.prepare.amount = destinationAmountOrError.toString()

    // Update balances on prepare
    const trxOrError = await services.accounts.transferFunds({
      sourceAccount: accounts.incoming,
      destinationAccount: accounts.outgoing,
      sourceAmount,
      destinationAmount: destinationAmountOrError,
      timeout: BigInt(5e9) // 5 seconds
    })

    if (isAccountTransferError(trxOrError)) {
      if (
        trxOrError === AccountTransferError.InsufficientBalance ||
        trxOrError === AccountTransferError.InsufficientLiquidity
      ) {
        throw new InsufficientLiquidityError(trxOrError)
      }

      //TODO: map transfer errors to ILP errors
      ctxThrow(500, trxOrError)
    } else {
      await next()

      if (response.fulfill) {
        await trxOrError.commit()
      } else {
        await trxOrError.rollback()
      }
    }
  }
}
