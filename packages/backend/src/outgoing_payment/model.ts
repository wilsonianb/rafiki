import { Pojo, Model, ModelOptions, QueryContext } from 'objection'
import * as Pay from '@interledger/pay'
import { v4 as uuid } from 'uuid'
import { Account } from '../open_payments/account/model'
import { BaseModel } from '../shared/baseModel'

const fieldPrefixes = ['intent', 'quote', 'destinationAccount', 'outcome']

const ratioFields = [
  'quoteMinExchangeRate',
  'quoteLowExchangeRateEstimate',
  'quoteHighExchangeRateEstimate'
]

export interface InvoiceIntent {
  invoiceUrl: string
  paymentPointer?: never
  amountToSend?: never
  amount?: never
  assetCode?: never
  assetScale?: never
  maxSourceAmount: bigint
}

export interface FixedSendIntent {
  invoiceUrl?: never
  paymentPointer: string
  amountToSend: bigint
  amount?: never
  assetCode?: never
  assetScale?: never
  maxSourceAmount?: never
}

export interface ArbitraryAssetIntent {
  invoiceUrl?: never
  paymentPointer: string
  amountToSend?: never
  amount: bigint
  assetCode: string
  assetScale: number
  maxSourceAmount: bigint
}

export type PaymentIntent =
  | InvoiceIntent
  | FixedSendIntent
  | ArbitraryAssetIntent

export class OutgoingPayment extends BaseModel {
  public static readonly tableName = 'outgoingPayments'

  public state!: PaymentState
  // The "| null" is necessary so that `$beforeUpdate` can modify a patch to remove the error. If `$beforeUpdate` set `error = undefined`, the patch would ignore the modification.
  public error?: string | null
  public stateAttempts!: number
  // The "| null" is necessary so that `$beforeUpdate` can modify a patch to remove the webhookId. If `$beforeUpdate` set `webhookId = undefined`, the patch would ignore the modification.
  public webhookId?: string | null

  public intent!: {
    paymentPointer?: string
    invoiceUrl?: string
    amountToSend?: bigint
    assetCode?: string
    assetScale?: number
    maxSourceAmount: bigint
  }

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
        switch (this.state) {
          case PaymentState.Funding:
          case PaymentState.Cancelled:
          case PaymentState.Completed:
            this.webhookId = uuid()
            break
          default:
            this.webhookId = null
        }
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
