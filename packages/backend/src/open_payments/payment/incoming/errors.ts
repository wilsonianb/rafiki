export enum IncomingPaymentError {
  UnknownAccount = 'UnknownAccount',
  InvalidAmount = 'InvalidAmount',
  UnknownPayment = 'UnknownPayment',
  InvalidState = 'InvalidState',
  InvalidExpiry = 'InvalidExpiry',
  WrongState = 'WrongState'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isIncomingPaymentError = (o: any): o is IncomingPaymentError =>
  Object.values(IncomingPaymentError).includes(o)

export const errorToCode: {
  [key in IncomingPaymentError]: number
} = {
  [IncomingPaymentError.UnknownAccount]: 404,
  [IncomingPaymentError.InvalidAmount]: 400,
  [IncomingPaymentError.UnknownPayment]: 404,
  [IncomingPaymentError.InvalidState]: 400,
  [IncomingPaymentError.InvalidExpiry]: 400,
  [IncomingPaymentError.WrongState]: 409
}

export const errorToMessage: {
  [key in IncomingPaymentError]: string
} = {
  [IncomingPaymentError.UnknownAccount]: 'unknown account',
  [IncomingPaymentError.InvalidAmount]: 'invalid amount',
  [IncomingPaymentError.UnknownPayment]: 'unknown payment',
  [IncomingPaymentError.InvalidState]: 'invalid state',
  [IncomingPaymentError.InvalidExpiry]: 'invalid expiresAt',
  [IncomingPaymentError.WrongState]: 'wrong state'
}
