import { BaseModel } from '../shared/baseModel'
import { AnyQueryBuilder } from 'objection'

export class Asset extends BaseModel {
  public static get tableName(): string {
    return 'assets'
  }

  static modifiers = {
    codeAndScale(query: AnyQueryBuilder): void {
      query.select('code', 'scale')
    },
    withSettleId(query: AnyQueryBuilder): void {
      query.select('code', 'scale', 'settlementBalanceId')
    },
    withUnit(query: AnyQueryBuilder): void {
      query.select('code', 'scale', 'unit')
    }
  }

  public readonly code!: string
  public readonly scale!: number

  // TigerBeetle account 2 byte unit field representing account's asset
  public readonly unit!: number

  // TigerBeetle account id tracking settlement account balance
  public readonly settlementBalanceId!: string
  // TigerBeetle account id tracking liquidity account balance
  public readonly liquidityBalanceId!: string
}
