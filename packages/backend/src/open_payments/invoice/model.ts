import { Model } from 'objection'
import { Account } from '../account/model'
import { Asset } from '../../asset/model'
import { LiquidityAccount } from '../../accounting/service'
import { ConnectorAccount } from '../../connector/core/rafiki'
import { BaseModel } from '../../shared/baseModel'
import { WebhookEvent } from '../../webhook/model'

export class Invoice
  extends BaseModel
  implements ConnectorAccount, LiquidityAccount {
  public static get tableName(): string {
    return 'invoices'
  }

  static relationMappings = {
    account: {
      relation: Model.HasOneRelation,
      modelClass: Account,
      join: {
        from: 'invoices.accountId',
        to: 'accounts.id'
      }
    }
  }

  // Open payments account id this invoice is for
  public accountId!: string
  public account!: Account
  public active!: boolean
  public description?: string
  public expiresAt!: Date
  public readonly amount!: bigint

  public processAt!: Date | null

  public get asset(): Asset {
    return this.account.asset
  }
}

export enum InvoiceEventType {
  InvoiceExpired = 'invoice.expired',
  InvoicePaid = 'invoice.paid'
}

export type InvoiceData = {
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

export class InvoiceEvent extends WebhookEvent {
  public type!: InvoiceEventType
  public data!: InvoiceData
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
