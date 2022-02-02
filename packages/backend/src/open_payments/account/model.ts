import { Model } from 'objection'

import { LiquidityAccount, BalanceOptions } from '../../accounting/service'
import { ConnectorAccount } from '../../connector/core/rafiki'
import { Asset } from '../../asset/model'
import { BaseModel } from '../../shared/baseModel'
import { EventType } from '../webhook/model'

export class Account
  extends BaseModel
  implements ConnectorAccount, LiquidityAccount {
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
}
