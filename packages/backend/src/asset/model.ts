import { BaseModel } from '../shared/baseModel'
import { v4 as uuid } from 'uuid'

export class Asset extends BaseModel {
  public static get tableName(): string {
    return 'assets'
  }

  public readonly code!: string
  public readonly scale!: number

  // TigerBeetle account 2 byte unit field representing account's asset
  public readonly unit!: number

  // TigerBeetle account id tracking settlement account balance
  public settlementBalanceId!: string
  // TigerBeetle account id tracking liquidity account balance
  public liquidityBalanceId!: string

  public $beforeInsert(): void {
    super.$beforeInsert()
    this.settlementBalanceId = this.settlementBalanceId || uuid()
    this.liquidityBalanceId = this.liquidityBalanceId || uuid()
  }
}
