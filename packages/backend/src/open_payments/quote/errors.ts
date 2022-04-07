export enum QuoteError {
  UnknownAccount = 'UnknownAccount',
  InvalidAmount = 'InvalidAmount',
  InvalidDestination = 'InvalidDestination',
  MissingIncomingPayment = 'MissingIncomingPayment'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isQuoteError = (o: any): o is QuoteError =>
  Object.values(QuoteError).includes(o)
