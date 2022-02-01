import { BaseModel } from '../../shared/baseModel'

export enum InvoiceEventType {
  InvoiceExpired = 'invoice.expired',
  InvoicePaid = 'invoice.paid'
}

export enum PaymentEventType {
  PaymentFunding = 'outgoing_payment.funding',
  PaymentCancelled = 'outgoing_payment.cancelled',
  PaymentCompleted = 'outgoing_payment.completed'
}

export const EventType = { ...InvoiceEventType, ...PaymentEventType }
export type EventType = InvoiceEventType | PaymentEventType

export class Webhook extends BaseModel {
  public static get tableName(): string {
    return 'webhookEvents'
  }

  // Open payments account id this invoice is for
  // public accountId!: string
  // public account!: Account
  public type!: EventType
  public attempts!: number
  public statusCode?: number
  // public readonly amount!: bigint
}
