export enum ChargeError {
  InsufficientBalance = 'InsufficientBalance',
  InvalidMandate = 'InvalidMandate',
  UnknownMandate = 'UnknownMandate'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isChargeError = (o: any): o is ChargeError =>
  Object.values(ChargeError).includes(o)
