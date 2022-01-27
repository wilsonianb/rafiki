import assert from 'assert'
import { Model } from 'objection'
import { Account } from '../account/model'
import { Asset } from '../../asset/model'
import { AccountingService, BaseAccountModel } from '../../shared/baseModel'

export class Invoice extends BaseAccountModel {
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

  public withdrawalAttempts!: number

  received?: bigint

  public get asset(): Asset {
    return this.account.asset
  }

  public async handlePayment(
    accountingService: AccountingService
  ): Promise<void> {
    const amountReceived = await accountingService.getTotalReceived(this.id)

    // This should be both defined and >0
    assert.ok(amountReceived)

    if (this.amount <= amountReceived) {
      await this.$query().patch({
        active: false,
        processAt: new Date()
      })
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
