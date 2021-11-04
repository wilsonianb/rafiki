import { BaseModel } from '../shared/baseModel'
import { Asset } from '../asset/model'
import { Model, RelationMappings } from 'objection'

export class Account extends BaseModel {
  public static get tableName(): string {
    return 'accounts'
  }

  public static get graph(): string {
    return `asset.${Asset.graph}`
  }

  static relationMappings = (): RelationMappings => ({
    asset: {
      relation: Model.HasOneRelation,
      modelClass: Asset,
      join: {
        from: 'accounts.assetId',
        to: 'assets.id'
      }
    }
  })

  public readonly disabled!: boolean

  public readonly assetId!: string
  public asset!: Asset
  // TigerBeetle account id tracking Interledger balance
  public readonly balanceId!: string
  // TigerBeetle account id tracking amount sent
  public readonly sentBalanceId?: string
}
