import { Model, QueryContext } from 'objection'

import { AccessType, AccessAction } from '../auth/grant'
import { AuthServer } from '../authServer/model'
import { BaseModel } from '../../shared/baseModel'

export class Grant extends BaseModel {
  public static get tableName(): string {
    return 'grants'
  }

  static get virtualAttributes(): string[] {
    return ['expired']
  }

  static relationMappings = {
    authServer: {
      relation: Model.BelongsToOneRelation,
      modelClass: AuthServer,
      join: {
        from: 'grants.authServerId',
        to: 'authServers.id'
      }
    }
  }

  public authServerId!: string
  public continueId?: string
  public continueToken?: string
  public accessToken?: string
  public accessType!: AccessType
  public accessActions!: AccessAction[]
  public expiresAt?: Date

  public get expired(): boolean {
    return !!this.expiresAt && this.expiresAt <= new Date()
  }

  $afterFind(queryContext: QueryContext): void {
    super.$afterFind(queryContext)
    delete this['authServer']
  }
}
