import { Model } from 'objection'

import { AccountModel, BalanceOptions } from '../../accounting/model'
import { Asset } from '../../asset/model'
import { AccountingService } from '../../shared/baseModel'

export class Account extends AccountModel {
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

  public get withdrawal(): BalanceOptions {
    return {
      threshold: this.asset.withdrawalThreshold,
      eventType: EventType.AccountWebMonetization,
      targetBalance: BigInt(0)
    }
  }

  public async handlePayment(
    _accountingService: AccountingService
  ): Promise<void> {
    // TODO: send webhook events
  }
}
