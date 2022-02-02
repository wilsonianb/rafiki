import { BaseModel } from '../shared/baseModel'

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

export class WebhookEvent extends BaseModel {
  public static get tableName(): string {
    return 'webhookEvents'
  }

  public type!: EventType
  public attempts!: number
  public statusCode?: number
}
