import { createHmac } from 'crypto'
import axios, { AxiosResponse } from 'axios'
import { PaymentType } from '@interledger/pay'
import { Logger } from 'pino'

import { IAppConfig } from '../config/app'
import { Account } from '../open_payments/account/model'
import { Invoice } from '../open_payments/invoice/model'
import { OutgoingPayment, PaymentState } from '../outgoing_payment/model'

enum AccountEventType {
  AccountWebMonetization = 'account.web_monetization'
}

enum InvoiceEventType {
  InvoiceExpired = 'invoice.expired',
  InvoicePaid = 'invoice.paid'
}

enum PaymentEventType {
  PaymentFunding = 'outgoing_payment.funding',
  PaymentCancelled = 'outgoing_payment.cancelled',
  PaymentCompleted = 'outgoing_payment.completed'
}

export const EventType = {
  ...AccountEventType,
  ...InvoiceEventType,
  ...PaymentEventType
}
export type EventType = AccountEventType | InvoiceEventType | PaymentEventType

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isInvoiceEventType = (type: any): type is InvoiceEventType =>
  Object.values(InvoiceEventType).includes(type)

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isPaymentEventType = (type: any): type is PaymentEventType =>
  Object.values(PaymentEventType).includes(type)

interface AccountEvent {
  id: string
  type: AccountEventType
  account: Account
  invoice?: never
  payment?: never
  amountReceived?: never
  amountSent?: never
  balance: bigint
}

interface InvoiceEvent {
  id: string
  type: InvoiceEventType
  account?: never
  invoice: Invoice
  payment?: never
  amountReceived: bigint
  amountSent?: never
  balance?: never
}

interface PaymentEvent {
  id: string
  type: PaymentEventType
  account?: never
  invoice?: never
  payment: OutgoingPayment
  amountReceived?: never
  amountSent: bigint
  balance: bigint
}

export type EventOptions = AccountEvent | InvoiceEvent | PaymentEvent

interface AccountData {
  account: {
    id: string
    asset: {
      id: string
      code: string
      scale: number
    }
    balance: string
  }
  invoice?: never
  payment?: never
}

interface InvoiceData {
  account?: never
  invoice: {
    id: string
    accountId: string
    active: boolean
    description?: string
    createdAt: string
    expiresAt: string
    amount: string
    received: string
  }
  payment?: never
}

interface PaymentData {
  account?: never
  invoice?: never
  payment: {
    id: string
    accountId: string
    createdAt: string
    state: PaymentState
    error?: string
    stateAttempts: number
    intent: {
      paymentPointer?: string
      invoiceUrl?: string
      amountToSend?: string
      autoApprove: boolean
    }

    quote?: {
      timestamp: string
      activationDeadline: string
      targetType: PaymentType
      minDeliveryAmount: string
      maxSourceAmount: string
      maxPacketAmount: string
      minExchangeRate: number
      lowExchangeRateEstimate: number
      highExchangeRateEstimate: number
    }
    destinationAccount: {
      scale: number
      code: string
      url?: string
    }
    outcome: {
      amountSent: string
    }
    balance: string
  }
}

type EventData = AccountData | InvoiceData | PaymentData

interface WebhookEvent {
  id: string
  type: EventType
  data: EventData
}

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
    data: getEventData(options)
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

function getEventData(options: EventOptions): EventData {
  if (options.account) {
    return accountToData(options.account, options.balance)
  } else if (options.invoice) {
    return invoiceToData(options.invoice, options.amountReceived)
  } else {
    return paymentToData(options.payment, options.amountSent, options.balance)
  }
}

export function accountToData(account: Account, balance: bigint): AccountData {
  return {
    account: {
      id: account.id,
      asset: {
        id: account.asset.id,
        code: account.asset.code,
        scale: account.asset.scale
      },
      balance: balance.toString()
    }
  }
}

export function invoiceToData(
  invoice: Invoice,
  amountReceived: bigint
): InvoiceData {
  return {
    invoice: {
      id: invoice.id,
      accountId: invoice.accountId,
      active: invoice.active,
      amount: invoice.amount.toString(),
      description: invoice.description,
      expiresAt: invoice.expiresAt.toISOString(),
      createdAt: new Date(+invoice.createdAt).toISOString(),
      received: amountReceived.toString()
    }
  }
}

export function paymentToData(
  payment: OutgoingPayment,
  amountSent: bigint,
  balance: bigint
): PaymentData {
  return {
    payment: {
      id: payment.id,
      accountId: payment.accountId,
      state: payment.state,
      error: payment.error || undefined,
      stateAttempts: payment.stateAttempts,
      intent: {
        ...payment.intent,
        amountToSend: payment.intent.amountToSend?.toString()
      },
      quote: payment.quote && {
        ...payment.quote,
        timestamp: payment.quote.timestamp.toISOString(),
        activationDeadline: payment.quote.activationDeadline.toISOString(),
        minDeliveryAmount: payment.quote.minDeliveryAmount.toString(),
        maxSourceAmount: payment.quote.maxSourceAmount.toString(),
        maxPacketAmount: payment.quote.maxPacketAmount.toString(),
        minExchangeRate: payment.quote.minExchangeRate.valueOf(),
        lowExchangeRateEstimate: payment.quote.lowExchangeRateEstimate.valueOf(),
        highExchangeRateEstimate: payment.quote.highExchangeRateEstimate.valueOf()
      },
      destinationAccount: payment.destinationAccount,
      createdAt: new Date(+payment.createdAt).toISOString(),
      outcome: {
        amountSent: amountSent.toString()
      },
      balance: balance.toString()
    }
  }
}
