import { Model } from 'objection'
import { Invoice } from '../invoice/model'
import { BaseModel } from '../shared/baseModel'

export class WebMonetization extends BaseModel {
  public static get tableName(): string {
    return 'webMonetization'
  }
  public static get graph(): string {
    return `invoice.${Invoice.graph}`
  }

  static relationMappings = {
    invoice: {
      relation: Model.HasOneRelation,
      modelClass: Invoice,
      join: {
        from: 'webMonetization.invoiceId',
        to: 'invoices.id'
      }
    }
  }

  // Represents the id of the payment pointers table
  public id!: string
  public invoiceId!: string
  public invoice!: Invoice
}
