import assert from 'assert'
import { createHmac } from 'crypto'
import axios, { AxiosResponse } from 'axios'
import { Logger } from 'pino'

import { AccountingService } from '../accounting/service'
import { IAppConfig } from '../config/app'
import { Invoice, InvoiceBody } from '../open_payments/invoice/model'
import { OutgoingPayment, PaymentBody } from '../outgoing_payment/model'

export enum DepositType {
  PaymentFunding = 'outgoing_payment.funding'
}

export enum InvoiceWithdrawalType {
  InvoiceExpired = 'invoice.expired',
  InvoicePaid = 'invoice.paid'
}

export enum PaymentWithdrawalType {
  PaymentFunding = 'outgoing_payment.funding',
  PaymentCancelled = 'outgoing_payment.cancelled',
  PaymentCompleted = 'outgoing_payment.completed'
}

export const WithdrawalType = {
  ...InvoiceWithdrawalType,
  ...PaymentWithdrawalType
}
export type WithdrawalType = InvoiceWithdrawalType | PaymentWithdrawalType

export const EventType = { ...DepositType, ...WithdrawalType }
export type EventType = DepositType | WithdrawalType

interface Options {
  id: string
  amount: bigint
}

export interface DepositOptions extends Options {
  type: DepositType
  payment: OutgoingPayment
}

interface InvoiceWithdrawalOptions extends Options {
  type: InvoiceWithdrawalType
  invoice: Invoice
  payment?: never
}

interface PaymentWithdrawalOptions extends Options {
  type: PaymentWithdrawalType
  invoice?: never
  payment: OutgoingPayment
}

export type WithdrawalOptions =
  | InvoiceWithdrawalOptions
  | PaymentWithdrawalOptions

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

export interface LiquidityService {
  deposit(options: DepositOptions): Promise<AxiosResponse> // return succeeded or cancelled
  withdraw(options: WithdrawalOptions): Promise<AxiosResponse> // return succeeded or retry?
}

interface ServiceDependencies {
  accountingService: AccountingService
  config: IAppConfig
  logger: Logger
}

export async function createLiquidityService(
  deps_: ServiceDependencies
): Promise<LiquidityService> {
  const logger = deps_.logger.child({
    service: 'LiquidityService'
  })
  const deps = { ...deps_, logger }
  return {
    deposit: (options) => depositLiquidity(deps, options),
    withdraw: (options) => withdrawLiquidity(deps, options)
  }
}

async function depositLiquidity(
  deps: ServiceDependencies,
  options: DepositOptions
): Promise<AxiosResponse> {
  const res = await sendWebhookEvent(deps, {
    id: options.id,
    type: options.type,
    data: {
      payment: options.payment.toBody()
    }
  })
  const error = await deps.accountingService.createDeposit({
    id: options.id,
    accountId: options.payment.id,
    amount: options.amount
  })
  if (error) throw new Error(error)
  return res
}

async function withdrawLiquidity(
  deps: ServiceDependencies,
  options: WithdrawalOptions
): Promise<AxiosResponse> {
  assert.ok(options.amount)
  const error = await deps.accountingService.createWithdrawal({
    id: options.id,
    accountId: options.invoice ? options.invoice.id : options.payment.id,
    amount: options.amount,
    timeout: BigInt(deps.config.webhookTimeout) * BigInt(1e6) // ms -> ns
  })
  if (error) throw new Error(error)
  try {
    const res = await sendWebhookEvent(deps, {
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
    const error = await deps.accountingService.commitWithdrawal(options.id)
    if (error) throw new Error(error)
    return res
  } catch (error) {
    await deps.accountingService.rollbackWithdrawal(options.id)
    throw error
  }
}

async function sendWebhookEvent(
  deps: ServiceDependencies,
  event: WebhookEvent
): Promise<AxiosResponse> {
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
