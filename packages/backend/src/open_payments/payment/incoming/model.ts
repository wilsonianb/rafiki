import { Model, Pojo } from 'objection'
import { Amount, AmountJSON } from '../../amount'
import { Asset } from '../../../asset/model'
import { LiquidityAccount, OnCreditOptions } from '../../../accounting/service'
import { ConnectorAccount } from '../../../connector/core/rafiki'
import { BaseModel } from '../../../shared/baseModel'
import { WebhookEvent } from '../../../webhook/model'

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

export type IncomingPaymentData = {
  incomingPayment: IncomingPaymentJSON
}

export class IncomingPaymentEvent extends WebhookEvent {
  public type!: IncomingPaymentEventType
  public data!: IncomingPaymentData
}

export class IncomingPayment
  extends BaseModel
  implements ConnectorAccount, LiquidityAccount {
  public static get tableName(): string {
    return 'incomingPayments'
  }

  static get virtualAttributes(): string[] {
    return ['incomingAmount', 'receivedAmount']
  }

  static relationMappings = {
    asset: {
      relation: Model.HasOneRelation,
      modelClass: Asset,
      join: {
        from: 'incomingPayments.assetId',
        to: 'assets.id'
      }
    }
  }

  // Open payments account id this incoming payment is for
  public accountId!: string
  public description?: string
  public expiresAt!: Date
  public state!: IncomingPaymentState
  public externalRef?: string
  public connectionId!: string

  public processAt!: Date | null

  public readonly assetId!: string
  public asset!: Asset

  private incomingAmountValue?: bigint | null
  private receivedAmountValue?: bigint

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
    return {
      incomingPayment: {
        id: this.id,
        accountId: this.accountId,
        createdAt: new Date(+this.createdAt).toISOString(),
        expiresAt: this.expiresAt.toISOString(),
        incomingAmount: this.incomingAmount
          ? {
              ...this.incomingAmount,
              value: this.incomingAmount.value.toString()
            }
          : null,
        receivedAmount: {
          value: amountReceived.toString(),
          assetCode: this.asset.code,
          assetScale: this.asset.scale
        },
        description: this.description ?? null,
        externalRef: this.externalRef ?? null,
        completed: this.state === IncomingPaymentState.Completed,
        updatedAt: new Date(+this.updatedAt).toISOString()
      }
    }
  }

  $formatJson(json: Pojo): Pojo {
    json = super.$formatJson(json)
    return {
      id: json.id,
      accountId: json.accountId,
      incomingAmount: this.incomingAmount
        ? {
            ...json.incomingAmount,
            value: json.incomingAmount.value.toString()
          }
        : null,
      receivedAmount: {
        ...json.receivedAmount,
        value: json.receivedAmount.value.toString()
      },
      completed: !!(this.state === IncomingPaymentState.Completed),
      description: json.description,
      externalRef: json.externalRef,
      createdAt: json.createdAt,
      updatedAt: json.updatedAt,
      expiresAt: json.expiresAt.toISOString(),
      ilpStreamConnection: json.connectionId
    }
  }
}

export type IncomingPaymentJSON = {
  id: string
  accountId: string
  incomingAmount: AmountJSON | null
  receivedAmount: AmountJSON
  completed: boolean
  description: string | null
  externalRef: string | null
  createdAt: string
  updatedAt: string
  expiresAt: string
  ilpStreamConnection: string
}
