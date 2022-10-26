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

interface BaseAccess {
  actions: Action[]
  identifier?: string
}

export interface IncomingPaymentAccess extends BaseAccess {
  type: AccessType.IncomingPayment
  limits?: never
}

interface OutgoingPaymentAccess extends BaseAccess {
  type: AccessType.OutgoingPayment
  limits?: OutgoingPaymentLimit
}

interface QuoteAccess extends BaseAccess {
  type: AccessType.Quote
  limits?: never
}

export type Access = IncomingPaymentAccess | OutgoingPaymentAccess | QuoteAccess

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

export function isIncomingPaymentAccess(
  access: IncomingPaymentAccess
): access is IncomingPaymentAccess {
  return (
    access.type === AccessType.IncomingPayment &&
    isAction(access.actions) &&
    !access.limits
  )
}

export function isOutgoingPaymentAccess(
  access: Access
): access is OutgoingPaymentAccess {
  return (
    access.type === AccessType.OutgoingPayment &&
    isAction(access.actions) &&
    (!access.limits || isOutgoingPaymentLimit(access.limits))
  )
}

function isQuoteAccess(access: QuoteAccess): access is QuoteAccess {
  return (
    access.type === AccessType.Quote &&
    isAction(access.actions) &&
    !access.limits
  )
}

export function isAccess(access: Access): access is Access {
  return (
    isIncomingPaymentAccess(access as IncomingPaymentAccess) ||
    isOutgoingPaymentAccess(access as OutgoingPaymentAccess) ||
    isQuoteAccess(access as QuoteAccess)
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
  interval?: string
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
