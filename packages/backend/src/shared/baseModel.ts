import { Model, ModelOptions, Pojo, QueryContext } from 'objection'
import { DbErrors } from 'objection-db-errors'
import { v4 as uuid } from 'uuid'

export abstract class BaseModel extends DbErrors(Model) {
  public static get modelPaths(): string[] {
    return [__dirname]
  }

  public id!: string
  public createdAt!: Date
  public updatedAt!: Date

  public $beforeInsert(): void {
    this.id = this.id || uuid()
    this.createdAt = new Date()
    this.updatedAt = new Date()
  }

  public $beforeUpdate(_opts: ModelOptions, _queryContext: QueryContext): void {
    this.updatedAt = new Date()
  }

  $formatJson(json: Pojo): Pojo {
    json = super.$formatJson(json)
    json.createdAt = json.createdAt.toISOString()
    json.updatedAt = json.updatedAt.toISOString()
    return json
  }
}
