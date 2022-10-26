import { Model } from 'objection'
import { BaseModel } from '../shared/baseModel'
import {
  LimitData,
  AccessType,
  Action,
  Access as AccessJSON,
  isOutgoingPaymentAccess
} from './types'
import { join } from 'path'

export class Access extends BaseModel {
  public static get tableName(): string {
    return 'accesses'
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  static relationMappings = () => ({
    grant: {
      relation: Model.HasOneRelation,
      modelClass: join(__dirname, '../grant/model'),
      join: {
        from: 'accesses.grantId',
        to: 'grants.id'
      }
    }
  })

  public id!: string
  public grantId!: string
  public type!: AccessType
  public actions!: Action[]
  public identifier?: string
  public limits?: LimitData

  public toBody(): AccessJSON {
    const access: AccessJSON = {
      type: this.type,
      actions: this.actions,
      identifier: this.identifier ?? undefined
    }
    if (isOutgoingPaymentAccess(access)) {
      access.limits = this.limits ?? undefined
    }
    return access
  }
}
