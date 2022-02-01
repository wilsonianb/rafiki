import { Model } from 'objection'
import { Account } from '../account/model'
import { BalanceOptions } from '../../accounting/service'
import { Asset } from '../../asset/model'
import { LiquidityAccount } from '../../accounting/service'
import { ConnectorAccount } from '../../connector/core/rafiki'
import { BaseModel } from '../../shared/baseModel'
import { EventType } from '../../webhook/model'

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

  // make this a function?
  public active!: boolean
  public description?: string
  public expiresAt!: Date
  public readonly amount!: bigint

  public get asset(): Asset {
    return this.account.asset
  }

  public get withdrawal(): BalanceOptions {
    return {
      threshold: this.amount,
      eventType: EventType.InvoicePaid,
      targetBalance: BigInt(0)
    }
  }

  public toBody(): InvoiceBody {
    assert.ok(this.received)
    return {
      id: this.id,
      accountId: this.accountId,
      active: this.active,
      amount: this.amount.toString(),
      description: this.description,
      expiresAt: this.expiresAt.toISOString(),
      createdAt: new Date(+this.createdAt).toISOString(),
      received: this.received.toString()
    }
  }
}

export interface InvoiceBody {
  id: string
  accountId: string
  active: boolean
  description?: string
  createdAt: string
  expiresAt: string
  amount: string
  received: string
}
