import { Model } from 'objection'
import { Account } from '../account/model'
import { BaseModel } from '../../shared/baseModel'

export class Grant extends BaseModel {
  public static get tableName(): string {
    return 'grants'
  }

  static relationMappings = {
    account: {
      relation: Model.HasOneRelation,
      modelClass: Account,
      join: {
        from: 'grants.accountId',
        to: 'accounts.id'
      }
    }
  }

  // Open payments account id this grant is for
  public readonly accountId!: string
  public account!: Account
  public readonly amount!: bigint
  public readonly assetCode!: string
  public readonly assetScale!: number
  public readonly startAt?: Date
  public readonly expiresAt?: Date
  public readonly interval?: string
  public balance!: bigint
  public processAt?: Date | null
}
