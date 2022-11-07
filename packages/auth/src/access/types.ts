export enum AccessType {
  IncomingPayment = 'incoming-payment',
  OutgoingPayment = 'outgoing-payment',
  Quote = 'quote'
}

export enum Action {
  Create = 'create',
  Read = 'read',
  ReadAll = 'read-all',
  List = 'list',
  ListAll = 'list-all',
  Complete = 'complete'
}

interface BaseAccessRequest {
  actions: Action[]
  identifier?: string
}

export interface IncomingPaymentRequest extends BaseAccessRequest {
  type: AccessType.IncomingPayment
  limits?: never
}

interface OutgoingPaymentRequest extends BaseAccessRequest {
  type: AccessType.OutgoingPayment
  limits?: OutgoingPaymentLimit
}

interface QuoteRequest extends BaseAccessRequest {
  type: AccessType.Quote
  limits?: never
}

export type AccessRequest =
  | IncomingPaymentRequest
  | OutgoingPaymentRequest
  | QuoteRequest

export function isAccessType(accessType: AccessType): accessType is AccessType {
  return Object.values(AccessType).includes(accessType)
}

export function isAction(actions: Action[]): actions is Action[] {
  if (typeof actions !== 'object') return false
  for (const action of actions) {
    if (!Object.values(Action).includes(action)) return false
  }

  return true
}

export function isIncomingPaymentAccessRequest(
  accessRequest: IncomingPaymentRequest
): accessRequest is IncomingPaymentRequest {
  return (
    accessRequest.type === AccessType.IncomingPayment &&
    isAction(accessRequest.actions) &&
    !accessRequest.limits
  )
}

function isOutgoingPaymentAccessRequest(
  accessRequest: OutgoingPaymentRequest
): accessRequest is OutgoingPaymentRequest {
  return (
    accessRequest.type === AccessType.OutgoingPayment &&
    isAction(accessRequest.actions) &&
    (!accessRequest.limits || isOutgoingPaymentLimit(accessRequest.limits))
  )
}

function isQuoteAccessRequest(
  accessRequest: QuoteRequest
): accessRequest is QuoteRequest {
  return (
    accessRequest.type === AccessType.Quote &&
    isAction(accessRequest.actions) &&
    !accessRequest.limits
  )
}

export function isAccessRequest(
  accessRequest: AccessRequest
): accessRequest is AccessRequest {
  return (
    isIncomingPaymentAccessRequest(accessRequest as IncomingPaymentRequest) ||
    isOutgoingPaymentAccessRequest(accessRequest as OutgoingPaymentRequest) ||
    isQuoteAccessRequest(accessRequest as QuoteRequest)
  )
}

// value should hold bigint, serialized as string for requests
// & storage as jsonb (postgresql.org/docs/current/datatype-json.html) field in postgres
export interface PaymentAmount {
  value: string
  assetCode: string
  assetScale: number
}

export type OutgoingPaymentLimit = {
  receiver: string
  sendAmount?: PaymentAmount
  receiveAmount?: PaymentAmount
}

export type LimitData = OutgoingPaymentLimit

function isPaymentAmount(
  paymentAmount: PaymentAmount | undefined
): paymentAmount is PaymentAmount {
  return (
    paymentAmount?.value !== undefined &&
    paymentAmount?.assetCode !== undefined &&
    paymentAmount?.assetScale !== undefined
  )
}

export function isOutgoingPaymentLimit(
  limit: OutgoingPaymentLimit
): limit is OutgoingPaymentLimit {
  return (
    typeof limit.receiver === 'string' &&
    isPaymentAmount(limit.sendAmount) &&
    isPaymentAmount(limit.receiveAmount)
  )
}
