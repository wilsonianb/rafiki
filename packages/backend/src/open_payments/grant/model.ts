import { BaseModel } from '../../shared/baseModel'

export class Grant extends BaseModel {
  public static get tableName(): string {
    return 'grants'
  }

  public readonly amount!: bigint
  public readonly assetCode!: string
  public readonly assetScale!: number
  public readonly startAt?: Date
  public readonly interval?: string
  public balance!: bigint
  public intervalEnd?: Date | null
}
