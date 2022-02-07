import { Pojo, Model, ModelOptions, QueryContext } from 'objection'
import * as Pay from '@interledger/pay'

import { LiquidityAccount } from '../accounting/service'
import { Asset } from '../asset/model'
import { ConnectorAccount } from '../connector/core/rafiki'
import { Account } from '../open_payments/account/model'
import { BaseModel } from '../shared/baseModel'
import { WebhookEvent } from '../webhook/model'

const fieldPrefixes = ['intent', 'quote', 'destinationAccount', 'outcome']

const ratioFields = [
  'quoteMinExchangeRate',
  'quoteLowExchangeRateEstimate',
  'quoteHighExchangeRateEstimate'
]

export type PaymentIntent = {
  paymentPointer?: string
  invoiceUrl?: string
  amountToSend?: bigint
  autoApprove: boolean
}

export class OutgoingPayment
  extends BaseModel
  implements ConnectorAccount, LiquidityAccount {
  public static readonly tableName = 'outgoingPayments'

  public state!: PaymentState
  // The "| null" is necessary so that `$beforeUpdate` can modify a patch to remove the error. If `$beforeUpdate` set `error = undefined`, the patch would ignore the modification.
  public error?: string | null
  public stateAttempts!: number

  public intent!: PaymentIntent

  public quote?: {
    timestamp: Date
    activationDeadline: Date
    targetType: Pay.PaymentType
    minDeliveryAmount: bigint
    maxSourceAmount: bigint
    maxPacketAmount: bigint
    minExchangeRate: Pay.Ratio
    lowExchangeRateEstimate: Pay.Ratio
    // Note that the upper exchange rate bound is *exclusive*.
    // (Pay.PositiveRatio, but validated later)
    highExchangeRateEstimate: Pay.Ratio
    // Amount already sent at the time of the quote
    amountSent: bigint
  }
  // Open payments account id of the sender
  public accountId!: string
  public account!: Account
  public destinationAccount!: {
    scale: number
    code: string
    url?: string
  }

  public get asset(): Asset {
    return this.account.asset
  }

  static relationMappings = {
    account: {
      relation: Model.HasOneRelation,
      modelClass: Account,
      join: {
        from: 'outgoingPayments.accountId',
        to: 'accounts.id'
      }
    }
  }

  $beforeUpdate(opts: ModelOptions, queryContext: QueryContext): void {
    super.$beforeUpdate(opts, queryContext)
    if (opts.old && this.state) {
      if (opts.old['error'] && this.state !== PaymentState.Cancelled) {
        this.error = null
      }
      if (opts.old['state'] !== this.state) {
        this.stateAttempts = 0
      }
    }
  }

  $formatDatabaseJson(json: Pojo): Pojo {
    for (const prefix of fieldPrefixes) {
      if (!json[prefix]) continue
      for (const key in json[prefix]) {
        json[prefix + key.charAt(0).toUpperCase() + key.slice(1)] =
          json[prefix][key]
      }
      delete json[prefix]
    }
    ratioFields.forEach((ratioField: string) => {
      if (!json[ratioField]) return
      json[ratioField + 'Numerator'] = json[ratioField].a.value
      json[ratioField + 'Denominator'] = json[ratioField].b.value
      delete json[ratioField]
    })
    return super.$formatDatabaseJson(json)
  }

  $parseDatabaseJson(json: Pojo): Pojo {
    json = super.$parseDatabaseJson(json)
    ratioFields.forEach((ratioField: string) => {
      if (
        json[ratioField + 'Numerator'] === null ||
        json[ratioField + 'Denominator'] === null
      ) {
        return
      }
      json[ratioField] = Pay.Ratio.of(
        Pay.Int.from(json[ratioField + 'Numerator']),
        Pay.Int.from(json[ratioField + 'Denominator'])
      )
      delete json[ratioField + 'Numerator']
      delete json[ratioField + 'Denominator']
    })
    for (const key in json) {
      const prefix = fieldPrefixes.find((prefix) => key.startsWith(prefix))
      if (!prefix) continue
      if (json[key] !== null) {
        if (!json[prefix]) json[prefix] = {}
        json[prefix][
          key.charAt(prefix.length).toLowerCase() + key.slice(prefix.length + 1)
        ] = json[key]
      }
      delete json[key]
    }
    return json
  }

  $formatJson(json: Pojo): Pojo {
    json = super.$formatJson(json)
    if (json.intent) {
      json.intent.amountToSend = json.intent.amountToSend?.toString()
    }
    if (json.quote) {
      json.quote = {
        ...json.quote,
        timestamp: json.quote.timestamp?.toISOString(),
        activationDeadline: json.quote.activationDeadline.toISOString(),
        minDeliveryAmount: json.quote.minDeliveryAmount.toString(),
        maxSourceAmount: json.quote.maxSourceAmount.toString(),
        maxPacketAmount: json.quote.maxPacketAmount.toString(),
        minExchangeRate: json.quote.minExchangeRate.valueOf(),
        lowExchangeRateEstimate: json.quote.lowExchangeRateEstimate.valueOf(),
        highExchangeRateEstimate: json.quote.highExchangeRateEstimate.valueOf(),
        amountSent: json.quote.amountSent.toString()
      }
    }
    return json
  }

  public toData({
    amountSent,
    balance
  }: {
    amountSent: bigint
    balance: bigint
  }): PaymentData {
    const data: PaymentData = ({
      payment: {
        ...this.toJSON(),
        outcome: {
          amountSent: amountSent.toString()
        },
        balance: balance.toString()
      }
    } as unknown) as PaymentData
    return data
  }
}

export enum PaymentState {
  // Initial state. In this state, an empty trustline account is generated, and the payment is automatically resolved & quoted.
  // On success, transition to `FUNDING` or `SENDING` if already funded.
  // On failure, transition to `CANCELLED`.
  Quoting = 'QUOTING',
  // Awaiting money from the user's wallet account to be deposited to the payment account to reserve it for the payment.
  // On success, transition to `SENDING`.
  Funding = 'FUNDING',
  // Pay from the trustline account to the destination.
  // On success, transition to `COMPLETED`.
  Sending = 'SENDING',

  // The payment failed. (Though some money may have been delivered).
  // Requoting transitions to `QUOTING`.
  Cancelled = 'CANCELLED',
  // Successful completion.
  Completed = 'COMPLETED'
}

export enum PaymentDepositType {
  PaymentFunding = 'outgoing_payment.funding'
}

export enum PaymentWithdrawType {
  PaymentCancelled = 'outgoing_payment.cancelled',
  PaymentCompleted = 'outgoing_payment.completed'
}

export const PaymentEventType = {
  ...PaymentDepositType,
  ...PaymentWithdrawType
}
export type PaymentEventType = PaymentDepositType | PaymentWithdrawType

export type PaymentData = {
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
      targetType: Pay.PaymentType
      minDeliveryAmount: string
      maxSourceAmount: string
      maxPacketAmount: string
      minExchangeRate: number
      lowExchangeRateEstimate: number
      highExchangeRateEstimate: number
      amountSent: string
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isPaymentEventType = (o: any): o is PaymentEventType =>
  Object.values(PaymentEventType).includes(o)

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isPaymentEvent = (o: any): o is PaymentEvent =>
  o instanceof WebhookEvent && isPaymentEventType(o.type)

export class PaymentEvent extends WebhookEvent {
  public type!: PaymentEventType
  public data!: PaymentData
}
