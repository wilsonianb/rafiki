import assert from 'assert'
import { Model } from 'objection'

import { Asset } from '../../asset/model'
import { AccountingService, BaseAccountModel } from '../../shared/baseModel'

export class Account extends BaseAccountModel {
  public static get tableName(): string {
    return 'accounts'
  }

  static relationMappings = {
    asset: {
      relation: Model.HasOneRelation,
      modelClass: Asset,
      join: {
        from: 'accounts.assetId',
        to: 'assets.id'
      }
    }
  }

  public readonly assetId!: string
  public asset!: Asset

  public processAt!: Date | null
  public webhookAttempts!: number

  public async handlePayment(
    accountingService: AccountingService
  ): Promise<void> {
    if (this.processAt === null) {
      const balance = await accountingService.getBalance(this.id)

      // This should be both defined and >0
      assert.ok(balance)

      if (this.asset.minAccountWithdrawalAmount <= balance) {
        await this.$query().patch({
          processAt: new Date()
        })
      }
    }
  }
}
