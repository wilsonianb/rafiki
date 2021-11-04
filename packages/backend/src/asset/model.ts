import { Model, RelationMappings } from 'objection'
import { Account } from '../account/model'
import { BaseModel } from '../shared/baseModel'

export class Asset extends BaseModel {
  public static get tableName(): string {
    return 'assets'
  }

  public static get graph(): string {
    return '[liquidityAccount.asset.settlementAccount, settlementAccount, sentAccount]'
  }

  static relationMappings = (): RelationMappings => ({
    liquidityAccount: {
      relation: Model.HasOneThroughRelation,
      modelClass: Account,
      join: {
        from: 'assets.id',
        through: {
          from: 'liquidityAccounts.id',
          to: 'liquidityAccounts.accountId'
        },
        to: 'accounts.id'
      }
    },
    settlementAccount: {
      relation: Model.HasOneThroughRelation,
      modelClass: Account,
      join: {
        from: 'assets.id',
        through: {
          from: 'settlementAccounts.id',
          to: 'settlementAccounts.accountId'
        },
        to: 'accounts.id'
      }
    },
    sentAccount: {
      relation: Model.HasOneThroughRelation,
      modelClass: Account,
      join: {
        from: 'assets.id',
        through: {
          from: 'sentAccounts.id',
          to: 'sentAccounts.accountId'
        },
        to: 'accounts.id'
      }
    }
  })

  public readonly code!: string
  public readonly scale!: number

  // TigerBeetle account 2 byte unit field representing account's asset
  public readonly unit!: number

  // Account tracking liquidity balance
  public liquidityAccount!: Account
  // Account tracking settlement balance
  public settlementAccount!: Account
  // Account tracking outgoing payments total sent
  public sentAccount!: Account
}

export class AssetAccount extends BaseModel {
  public accountId!: string
  public account!: Account
}

export class LiquidityAccount extends AssetAccount {
  public static get tableName(): string {
    return 'liquidityAccounts'
  }
}

export class SettlementAccount extends AssetAccount {
  public static get tableName(): string {
    return 'settlementAccounts'
  }
}

export class SentAccount extends AssetAccount {
  public static get tableName(): string {
    return 'sentAccounts'
  }
}
