import { createHmac } from 'crypto'
import axios from 'axios'

import {
  WebhookEvent,
  EventType,
  InvoiceEventType,
  PaymentEventType
} from './model'
import { IAppConfig } from '../config/app'
import { Invoice, InvoiceBody } from '../open_payments/invoice/model'
import { OutgoingPayment, PaymentBody } from '../outgoing_payment/model'
import { BaseService } from '../shared/baseService'

// First retry waits 10 seconds, second retry waits 20 (more) seconds, etc.
export const RETRY_BACKOFF_SECONDS = 10
export const RETRY_LIMIT_SECONDS = 60 * 60 * 24 // 1 day
export const RETENTION_LIMIT_SECONDS = 60 * 60 * 24 * 30 // 30 days

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
  createEvent(options: EventOptions): Promise<WebhookEvent>
  getEvent(id: string): Promise<WebhookEvent>
  processNext(): Promise<string | undefined>
}

interface ServiceDependencies extends BaseService {
  config: IAppConfig
}

export async function createWebhookService(
  deps_: ServiceDependencies
): Promise<WebhookService> {
  const logger = deps_.logger.child({
    service: 'WebhookService'
  })
  const deps = { ...deps_, logger }
  return {
    createEvent: (options) => createWebhookEvent(deps, options),
    getEvent: (id) => getWebhookEvent(deps, id),
    processNext: () => processNextWebhookEvent(deps)
  }
}

async function createWebhookEvent(
  deps: ServiceDependencies,
  options: EventOptions,
  trx?: Transaction
): Promise<WebhookEvent> {
  return await WebhookEvent.query(trx || deps.knex).insertAndFetch({
    id: options.id,
    type: options.type,
    data: options.invoice
      ? {
          invoice: options.invoice.toBody()
        }
      : {
          payment: options.payment.toBody()
        }
  })
}

async function getWebhookEvent(
  deps: ServiceDependencies,
  id: string
): Promise<WebhookEvent> {
  return WebhookEvent.query(deps.knex).findById(id)
}

// Fetch (and lock) a webhook event for work.
// Returns the id of the processed event (if any).
async function processNextWebhookEvent(
  deps_: ServiceDependencies
): Promise<string | undefined> {
  return deps_.knex.transaction(async (trx) => {
    const now = new Date(Date.now()).toISOString()
    const events = await WebhookEvent.query(trx)
      .limit(1)
      // Ensure the webhook event cannot be processed concurrently by multiple workers.
      .forUpdate()
      // If a webhook event is locked, don't wait — just come back for it later.
      .skipLocked()
      .where('processAt', '<', now)

    const event = events[0]
    if (!event) return

    const deps = {
      ...deps_,
      knex: trx,
      logger: deps_.logger.child({
        event: event.id
      })
    }
    await sendWebhookEvent(deps, event)
    return invoice.id
  })
}

async function sendWebhookEvent(
  deps: ServiceDependencies,
  event: WebhookEvent
): Promise<void> {
  try {
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

    const body = {
      id: event.id,
      type: event.type,
      data: event.data
    }

    await axios.post(deps.config.webhookUrl, body, {
      timeout: deps.config.webhookTimeout,
      headers: requestHeaders
    })
  } catch (err) {
    // log
    await event.$query(deps.knex).patch({
      attempts: event.attempts + 1
    })
  }
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
