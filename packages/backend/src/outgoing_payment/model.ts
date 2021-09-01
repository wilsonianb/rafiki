import { Pojo, Model, ModelOptions, QueryContext } from 'objection'
import * as Pay from '@interledger/pay'
import { BaseModel } from '../shared/baseModel'
import { PaymentProgress } from '../payment_progress/model'

const fieldPrefixes = [
  'intent',
  'quote',
  'sourceAccount',
  'destinationAccount',
  'outcome'
]

export type PaymentIntent = {
  paymentPointer?: string
  invoiceUrl?: string
  amountToSend?: bigint
  autoApprove: boolean
}

export class OutgoingPayment extends BaseModel {
  public static readonly tableName = 'outgoingPayments'

  static relationMappings = {
    outcome: {
      relation: Model.HasOneRelation,
      modelClass: PaymentProgress,
      join: {
        from: 'outgoingPayments.id',
        to: 'paymentProgress.id'
      }
    }
  }

  public state!: PaymentState
  // The "| null" is necessary so that `$beforeUpdate` can modify a patch to remove the error. If `$beforeUpdate` set `error = undefined`, the patch would ignore the modification.
  public error?: string | null
  public attempts!: number

  public intent!: PaymentIntent

  public quote?: {
    timestamp: Date
    activationDeadline: Date
    targetType: Pay.PaymentType
    minDeliveryAmount: bigint
    maxSourceAmount: bigint
    maxPacketAmount: bigint
    minExchangeRate: number
    lowExchangeRateEstimate: number
    highExchangeRateEstimate: number
    //estimatedDuration: number // milliseconds
  }
  public superAccountId!: string
  public sourceAccount!: {
    id: string
    scale: number
    code: string
  }
  public destinationAccount!: {
    scale: number
    code: string
    url?: string
    // TODO: why even store this in addition to url? it doesn't always exist (url does); from spec:
    // Payment pointer, prefixed with "$", corresponding to the recipient Open Payments/SPSP account. Each payment pointer and its corresponding account URL identifies a unique payment recipient.
    paymentPointer?: string
  }
  public readonly outcome?: PaymentProgress

  $beforeUpdate(opts: ModelOptions, queryContext: QueryContext): void {
    super.$beforeUpdate(opts, queryContext)
    if (
      opts.old &&
      opts.old['error'] &&
      this.state &&
      this.state !== PaymentState.Cancelling &&
      this.state !== PaymentState.Cancelled
    ) {
      this.error = null
    }
    if (opts.old && this.state && opts.old['state'] !== this.state) {
      this.attempts = 0
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
    return super.$formatDatabaseJson(json)
  }

  $parseDatabaseJson(json: Pojo): Pojo {
    json = super.$parseDatabaseJson(json)
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
  // On success, transition to `Ready`.
  // On failure, transition to `Cancelled`.
  Inactive = 'Inactive',
  // Awaiting user approval. Approval is automatic if `autoApprove` is set.
  // Once approved, transitions to `Activated`.
  Ready = 'Ready',
  // During activation, money from the user's (parent) account is moved to the trustline to reserve it for the payment.
  // On success, transition to `Sending`.
  Activated = 'Activated',
  // Pay from the trustline account to the destination.
  Sending = 'Sending',

  // Transitions to Cancelled once leftover reserved money is refunded to the parent account.
  Cancelling = 'Cancelling',
  // The payment failed. (Though some money may have been delivered).
  // Requoting transitions to `Inactive`.
  Cancelled = 'Cancelled',
  // Successful completion.
  Completed = 'Completed'
}
