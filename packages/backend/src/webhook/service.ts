import { createHmac } from 'crypto'
import axios, { AxiosResponse } from 'axios'
import { Logger } from 'pino'

import { EventType, InvoiceEventType, PaymentEventType } from './model'
import { IAppConfig } from '../config/app'
import { Invoice, InvoiceBody } from '../open_payments/invoice/model'
import { OutgoingPayment, PaymentBody } from '../outgoing_payment/model'

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isPaymentEventType = (type: any): type is PaymentEventType =>
  Object.values(PaymentEventType).includes(type)

interface InvoiceEvent {
  id: string
  type: InvoiceEventType
  invoice: Invoice
  payment?: never
  amountReceived: bigint
  amountSent?: never
  balance?: never
}

interface PaymentEvent {
  id: string
  type: PaymentEventType
  invoice?: never
  payment: OutgoingPayment
  amountReceived?: never
  amountSent: bigint
  balance: bigint
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
  create(options: EventOptions): Promise<AxiosResponse>
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
    create: (options) => createWebhook(deps, options),
    timeout: deps.config.webhookTimeout
  }
}

async function createWebhook(
  deps: ServiceDependencies,
  options: EventOptions
  // trx
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
