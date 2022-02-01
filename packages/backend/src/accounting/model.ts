import { BaseModel } from '../shared/baseModel'
import { EventType } from '../webhook/model'

export interface AccountingService {
  getBalance(id: string): Promise<bigint | undefined>
  getTotalReceived(id: string): Promise<bigint | undefined>
}

export interface BalanceOptions {
  // id?
  threshold: bigint
  eventType: EventType
  targetBalance: bigint
}

export abstract class AccountModel extends BaseModel {
  public abstract asset: {
    code: string
    scale: number
  }

  // public depositThreshold?: bigint
  // public withdrawalThreshold?: bigint
  // public targetBalance?: bigint

  // public withdrawalEventType: EventType

  public deposit?: BalanceOptions
  public withdrawal?: BalanceOptions

  public abstract handlePayment(
    accountingService: AccountingService
  ): Promise<void>
}
