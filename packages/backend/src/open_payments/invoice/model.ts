import { Model, QueryBuilder } from 'objection'
import { Account } from '../account/model'
import { Asset } from '../../asset/model'
import { LiquidityAccount } from '../../accounting/service'
import { ConnectorAccount } from '../../connector/core/rafiki'
import { BaseModel } from '../../shared/baseModel'

export enum InvoiceEventType {
  InvoiceExpired = 'invoice.expired',
  InvoicePaid = 'invoice.paid'
}

export class Invoice
  extends BaseModel
  implements ConnectorAccount, LiquidityAccount {
  public static get tableName(): string {
    return 'invoices'
  }

  static modifiers = {
    whereAccount(query: QueryBuilder<Invoice>, accountId: string): void {
      query.where({ accountId })
    },
    whereEvent(query: QueryBuilder<Invoice>): void {
      query.whereNotNull('event')
    }
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
  public event?: InvoiceEventType

  public processAt!: Date | null

  public get asset(): Asset {
    return this.account.asset
  }

  public async onCredit(balance: bigint): Promise<Invoice> {
    if (this.active) {
      if (this.amount <= balance) {
        await this.$query().patch({
          active: false,
          event: InvoiceEventType.InvoicePaid
        })
      }
    } else {
      await this.$query().patch({
        event: InvoiceEventType.InvoicePaid
      })
    }
    return this
  }
}
