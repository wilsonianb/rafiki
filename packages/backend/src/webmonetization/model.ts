import { BaseModel } from '../shared/baseModel'

export class WebMonetization extends BaseModel {
  public static get tableName(): string {
    return 'webMonetization'
  }

  // Represents the id of the payment pointers table
  public id!: string
  public currentInvoiceId!: string
}
