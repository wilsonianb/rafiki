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

  public async handlePayment(
    _accountingService: AccountingService
  ): Promise<void> {
    // const balance = await accountingService.getBalance(
    //   this.id
    // )
    // if (!balance || balance < this.asset.minAccountWithdrawAmount) {
    //   return
    // }
    // await this.$query()
    //   .patch({
    //     active: false,
    //     processAt: new Date()
    //   })
  }
}
