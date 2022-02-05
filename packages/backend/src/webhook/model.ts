import { BaseModel } from '../shared/baseModel'

export class WebhookEvent extends BaseModel {
  public static get tableName(): string {
    return 'webhookEvents'
  }

  // public accountId!: string
  public type!: string
  public data!: Record<string, unknown>
  public delivered!: boolean
  public attempts!: number
  public error?: string | null
  public processAt!: Date
}
