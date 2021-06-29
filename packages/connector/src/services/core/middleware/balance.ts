import { RafikiContext } from '../rafiki'
import { isTransferError } from 'accounts'

export function createBalanceMiddleware() {
  return async (
    { request, response, services, accounts }: RafikiContext,
    next: () => Promise<unknown>
  ): Promise<void> => {
    const { amount } = request.prepare

    // Ignore zero amount packets
    if (amount === '0') {
      await next()
      return
    }

    // Update balances on prepare
    const trxOrError = await services.accounts.transferFunds({
      sourceAccountId: accounts.incoming.accountId,
      destinationAccountId: accounts.outgoing.accountId,
      sourceAmount: BigInt(amount)
    })

    await next()

    if (!isTransferError(trxOrError)) {
      if (response.fulfill) {
        await trxOrError.commit()
      } else {
        await trxOrError.rollback()
      }
    }
  }
}
