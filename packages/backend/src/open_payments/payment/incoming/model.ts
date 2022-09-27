import { Model, ModelOptions, Pojo, QueryContext } from 'objection'
import { v4 as uuid } from 'uuid'

import { Amount, AmountJSON } from '../../amount'
import { ConnectionJSON } from '../../connection/service'
import { PaymentPointer } from '../../payment_pointer/model'
import { Asset } from '../../../asset/model'
import { LiquidityAccount, OnCreditOptions } from '../../../accounting/service'
import { ConnectorAccount } from '../../../connector/core/rafiki'
import { BaseModel } from '../../../shared/baseModel'
import { WebhookEvent } from '../../../webhook/model'
import { GrantReference } from '../../grantReference/model'

export enum IncomingPaymentEventType {
  IncomingPaymentExpired = 'incoming_payment.expired',
  IncomingPaymentCompleted = 'incoming_payment.completed'
}

export enum IncomingPaymentState {
  // The payment has a state of `PENDING` when it is initially created.
  Pending = 'PENDING',
  // As soon as payment has started (funds have cleared into the account) the state moves to `PROCESSING`.
  Processing = 'PROCESSING',
  // The payment is either auto-completed once the received amount equals the expected `incomingAmount`,
  // or it is completed manually via an API call.
  Completed = 'COMPLETED',
  // If the payment expires before it is completed then the state will move to `EXPIRED`
  // and no further payments will be accepted.
  Expired = 'EXPIRED'
}

export interface IncomingPaymentResponse {
  id: string
  paymentPointerId: string
  description?: string
  createdAt: string
  updatedAt: string
  expiresAt: string
  incomingAmount?: AmountJSON
  receivedAmount: AmountJSON
  externalRef?: string
  completed: boolean
}

export type IncomingPaymentData = {
  incomingPayment: IncomingPaymentResponse
}

export class IncomingPaymentEvent extends WebhookEvent {
  public type!: IncomingPaymentEventType
  public data!: IncomingPaymentData
}

export class IncomingPayment
  extends BaseModel
  implements ConnectorAccount, LiquidityAccount
{
  public static get tableName(): string {
    return 'incomingPayments'
  }

  static get virtualAttributes(): string[] {
    return ['completed', 'incomingAmount', 'receivedAmount', 'url']
  }

  static relationMappings = {
    asset: {
      relation: Model.HasOneRelation,
      modelClass: Asset,
      join: {
        from: 'incomingPayments.assetId',
        to: 'assets.id'
      }
    },
    paymentPointer: {
      relation: Model.BelongsToOneRelation,
      modelClass: PaymentPointer,
      join: {
        from: 'incomingPayments.paymentPointerId',
        to: 'paymentPointers.id'
      }
    },
    grantRef: {
      relation: Model.HasOneRelation,
      modelClass: GrantReference,
      join: {
        from: 'incomingPayments.grantId',
        to: 'grantReferences.id'
      }
    }
  }

  // Open payments paymentPointer id this incoming payment is for
  public paymentPointerId!: string
  public paymentPointer!: PaymentPointer
  public description?: string
  public expiresAt!: Date
  public state!: IncomingPaymentState
  public externalRef?: string
  // The "| null" is necessary so that `$beforeUpdate` can modify a patch to remove the connectionId. If `$beforeUpdate` set `error = undefined`, the patch would ignore the modification.
  public connectionId?: string | null

  public grantId?: string
  private grantRef?: GrantReference

  public processAt!: Date | null

  public readonly assetId!: string
  public asset!: Asset

  private incomingAmountValue?: bigint | null
  private receivedAmountValue?: bigint

  public get completed(): boolean {
    return this.state === IncomingPaymentState.Completed
  }

  public get incomingAmount(): Amount | undefined {
    if (this.incomingAmountValue) {
      return {
        value: this.incomingAmountValue,
        assetCode: this.asset.code,
        assetScale: this.asset.scale
      }
    }
    return undefined
  }

  public set incomingAmount(amount: Amount | undefined) {
    this.incomingAmountValue = amount?.value ?? null
  }

  public get receivedAmount(): Amount {
    return {
      value: this.receivedAmountValue || BigInt(0),
      assetCode: this.asset.code,
      assetScale: this.asset.scale
    }
  }

  public set receivedAmount(amount: Amount) {
    this.receivedAmountValue = amount.value
  }

  public get url(): string {
    return `${this.paymentPointer.url}/incoming-payments/${this.id}`
  }

  public async onCredit({
    totalReceived
  }: OnCreditOptions): Promise<IncomingPayment> {
    let incomingPayment
    if (this.incomingAmount && this.incomingAmount.value <= totalReceived) {
      incomingPayment = await IncomingPayment.query()
        .patchAndFetchById(this.id, {
          state: IncomingPaymentState.Completed,
          // Add 30 seconds to allow a prepared (but not yet fulfilled/rejected) packet to finish before sending webhook event.
          processAt: new Date(Date.now() + 30_000)
        })
        .whereNotIn('state', [
          IncomingPaymentState.Expired,
          IncomingPaymentState.Completed
        ])
    } else {
      incomingPayment = await IncomingPayment.query()
        .patchAndFetchById(this.id, {
          state: IncomingPaymentState.Processing
        })
        .whereNotIn('state', [
          IncomingPaymentState.Expired,
          IncomingPaymentState.Completed
        ])
    }
    if (incomingPayment) {
      return incomingPayment
    }
    return this
  }

  public toData(amountReceived: bigint): IncomingPaymentData {
    const data: IncomingPaymentData = {
      incomingPayment: {
        id: this.id,
        paymentPointerId: this.paymentPointerId,
        createdAt: new Date(+this.createdAt).toISOString(),
        expiresAt: this.expiresAt.toISOString(),
        receivedAmount: {
          value: amountReceived.toString(),
          assetCode: this.asset.code,
          assetScale: this.asset.scale
        },
        completed: this.completed,
        updatedAt: new Date(+this.updatedAt).toISOString()
      }
    }

    if (this.incomingAmount) {
      data.incomingPayment.incomingAmount = {
        ...this.incomingAmount,
        value: this.incomingAmount.value.toString()
      }
    }
    if (this.description) {
      data.incomingPayment.description = this.description
    }
    if (this.externalRef) {
      data.incomingPayment.externalRef = this.externalRef
    }

    return data
  }

  public $beforeInsert(context): void {
    super.$beforeInsert(context)
    this.connectionId = this.connectionId || uuid()
  }

  public $beforeUpdate(opts: ModelOptions, queryContext: QueryContext): void {
    super.$beforeUpdate(opts, queryContext)
    if (
      [IncomingPaymentState.Completed, IncomingPaymentState.Expired].includes(
        this.state
      )
    ) {
      this.connectionId = null
    }
  }

  static async afterFind(args) {
    args.result.forEach(async (payment) => {
      payment.grantRef = undefined
    })
    return args.result
  }

  $formatJson(json: Pojo): Pojo {
    json = super.$formatJson(json)
    const payment: Pojo = {
      id: json.id,
      receivedAmount: {
        ...json.receivedAmount,
        value: json.receivedAmount.value.toString()
      },
      completed: json.completed,
      createdAt: json.createdAt,
      updatedAt: json.updatedAt,
      expiresAt: json.expiresAt.toISOString()
    }
    if (json.incomingAmount) {
      payment.incomingAmount = {
        ...json.incomingAmount,
        value: json.incomingAmount.value.toString()
      }
    }
    if (json.description) {
      payment.description = json.description
    }
    if (json.externalRef) {
      payment.externalRef = json.externalRef
    }
    return payment
  }
}

// TODO: disallow undefined
// https://github.com/interledger/rafiki/issues/594
export type IncomingPaymentJSON = {
  id: string
  paymentPointer: string
  incomingAmount?: AmountJSON
  receivedAmount: AmountJSON
  completed: boolean
  description?: string
  externalRef?: string
  createdAt: string
  updatedAt: string
  expiresAt?: string
  ilpStreamConnection?: ConnectionJSON | string
}
