interface WithdrawalOptions {
  id?: string
  amount: bigint
}

export interface AccountWithdrawal extends WithdrawalOptions {
  accountId: string
}

export interface LiquidityWithdrawal extends WithdrawalOptions {
  assetCode: string
  assetScale: number
}

export type Withdrawal = Required<AccountWithdrawal> & {
  // createdTime: bigint
}

export enum WithdrawError {
  InsufficientBalance = 'InsufficientBalance',
  InsufficientLiquidity = 'InsufficientLiquidity',
  InsufficientSettlementBalance = 'InsufficientSettlementBalance',
  InvalidId = 'InvalidId',
  UnknownAccount = 'UnknownAccount',
  UnknownLiquidityAccount = 'UnknownLiquidityAccount',
  UnknownSettlementAccount = 'UnknownSettlementAccount',
  WithdrawalExists = 'WithdrawalExists'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isWithdrawError = (o: any): o is WithdrawError =>
  Object.values(WithdrawError).includes(o)
