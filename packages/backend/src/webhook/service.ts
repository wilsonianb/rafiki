import { createHmac } from 'crypto'
import axios, { AxiosResponse } from 'axios'
import { Logger } from 'pino'

import { IAppConfig } from '../config/app'
import { Invoice, InvoiceBody } from '../open_payments/invoice/model'
import { OutgoingPayment, PaymentBody } from '../outgoing_payment/model'

enum InvoiceEventType {
  InvoiceExpired = 'invoice.expired',
  InvoicePaid = 'invoice.paid'
}

enum PaymentEventType {
  PaymentFunding = 'outgoing_payment.funding',
  PaymentCancelled = 'outgoing_payment.cancelled',
  PaymentCompleted = 'outgoing_payment.completed'
}

export const EventType = { ...InvoiceEventType, ...PaymentEventType }
export type EventType = InvoiceEventType | PaymentEventType

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isPaymentEventType = (type: any): type is PaymentEventType =>
  Object.values(PaymentEventType).includes(type)

interface InvoiceEvent {
  id: string
  type: InvoiceEventType
  invoice: Invoice
  payment?: never
}

interface PaymentEvent {
  id: string
  type: PaymentEventType
  invoice?: never
  payment: OutgoingPayment
}

export type EventOptions = InvoiceEvent | PaymentEvent

interface InvoiceData {
  invoice: InvoiceBody
  payment?: never
}

interface PaymentData {
  invoice?: never
  payment: PaymentBody
}

interface WebhookEvent {
  id: string
  type: EventType
  data: InvoiceData | PaymentData
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isPaymentEvent = (event: any): event is PaymentEvent =>
  Object.values(PaymentEventType).includes(event.type)

export interface WebhookService {
  send(options: EventOptions): Promise<AxiosResponse>
  readonly timeout: number
}

interface ServiceDependencies {
  config: IAppConfig
  logger: Logger
}

export async function createWebhookService(
  deps_: ServiceDependencies
): Promise<WebhookService> {
  const logger = deps_.logger.child({
    service: 'WebhookService'
  })
  const deps = { ...deps_, logger }
  return {
    send: (options) => sendWebhook(deps, options),
    timeout: deps.config.webhookTimeout
  }
}

async function sendWebhook(
  deps: ServiceDependencies,
  options: EventOptions
): Promise<AxiosResponse> {
  const event = {
    id: options.id,
    type: options.type,
    data: options.invoice
      ? {
          invoice: options.invoice.toBody()
        }
      : {
          payment: options.payment.toBody()
        }
  }
  const requestHeaders = {
    'Content-Type': 'application/json'
  }

  if (deps.config.webhookSecret) {
    requestHeaders['Rafiki-Signature'] = generateWebhookSignature(
      event,
      deps.config.webhookSecret,
      deps.config.signatureVersion
    )
  }

  return await axios.post(deps.config.webhookUrl, event, {
    timeout: deps.config.webhookTimeout,
    headers: requestHeaders
  })
}

export function generateWebhookSignature(
  event: WebhookEvent,
  secret: string,
  version: number
): string {
  const timestamp = Math.round(new Date().getTime() / 1000)

  const payload = `${timestamp}.${event}`
  const hmac = createHmac('sha256', secret)
  hmac.update(payload)
  const digest = hmac.digest('hex')

  return `t=${timestamp}, v${version}=${digest}`
}
