import * as Pay from '@interledger/pay'

export enum OutgoingPaymentError {
  UnknownPayment = 'UnknownPayment',
  WrongState = 'WrongState'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isOutgoingPaymentError = (o: any): o is OutgoingPaymentError =>
  Object.values(OutgoingPaymentError).includes(o)

export type PaymentError = LifecycleError | Pay.PaymentError

export enum LifecycleError {
  QuoteExpired = 'QuoteExpired',
  InsufficientMandate = 'InsufficientMandate',
  // Rate fetch failed.
  PricesUnavailable = 'PricesUnavailable',
  // Payment aborted via "cancel payment" API call.
  CancelledByAPI = 'CancelledByAPI',
  // Payment aborted via "cancel mandate" API call.
  CancelledByMandate = 'CancelledByMandate',
  // Edge error due to retries, partial payment, and database write errors.
  BadState = 'BadState',

  // These errors shouldn't ever trigger (impossible states), but they exist to satisfy types:
  MissingBalance = 'MissingBalance',
  MissingQuote = 'MissingQuote',
  MissingInvoice = 'MissingInvoice',
  InvalidRatio = 'InvalidRatio'
}

const retryablePaymentErrors: { [paymentError in PaymentError]?: boolean } = {
  // Lifecycle errors
  PricesUnavailable: true,
  // From @interledger/pay's PaymentError:
  QueryFailed: true,
  ConnectorError: true,
  EstablishmentFailed: true,
  InsufficientExchangeRate: true,
  RateProbeFailed: true,
  IdleTimeout: true,
  ClosedByReceiver: true
}

export function canRetryError(err: Error | PaymentError): boolean {
  return err instanceof Error || !!retryablePaymentErrors[err]
}
