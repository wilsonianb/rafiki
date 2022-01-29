import assert from 'assert'
import { Model, Pojo } from 'objection'
import { v4 as uuid } from 'uuid'

import { Asset } from '../../asset/model'
import { AccountingService, BaseAccountModel } from '../../shared/baseModel'

const fieldPrefixes = ['withdrawal']

export class Account extends BaseAccountModel {
  public static get tableName(): string {
    return 'accounts'
  }

  static relationMappings = {
    asset: {
      relation: Model.HasOneRelation,
      modelClass: Asset,
      join: {
        from: 'accounts.assetId',
        to: 'assets.id'
      }
    }
  }

  public readonly assetId!: string
  public asset!: Asset

  public balanceWithdrawalThreshold?: bigint

  public processAt?: Date | null
  public withdrawal?: {
    id: string
    amount: bigint
    attempts: number
    transferId: string
  } | null

  public async handlePayment(
    accountingService: AccountingService
  ): Promise<void> {
    if (this.balanceWithdrawalThreshold && this.withdrawal === null) {
      const balance = await accountingService.getBalance(this.id)

      // This should be both defined and >0
      assert.ok(balance)

      if (this.balanceWithdrawalThreshold <= balance) {
        await this.$query().patch({
          processAt: new Date(),
          withdrawal: {
            id: uuid(),
            amount: balance,
            attempts: 0,
            transferId: uuid()
          }
        })
      }
    }
  }

  $formatDatabaseJson(json: Pojo): Pojo {
    for (const prefix of fieldPrefixes) {
      if (json[prefix] === undefined) continue
      for (const key in json[prefix]) {
        json[prefix + key.charAt(0).toUpperCase() + key.slice(1)] =
          json[prefix][key]
      }
      delete json[prefix]
    }
    return super.$formatDatabaseJson(json)
  }

  $parseDatabaseJson(json: Pojo): Pojo {
    json = super.$parseDatabaseJson(json)
    for (const key in json) {
      const prefix = fieldPrefixes.find((prefix) => key.startsWith(prefix))
      if (!prefix) continue
      if (json[key] !== null) {
        if (!json[prefix]) json[prefix] = {}
        json[prefix][
          key.charAt(prefix.length).toLowerCase() + key.slice(prefix.length + 1)
        ] = json[key]
      } else if (!json[prefix]) json[prefix] = null
      delete json[key]
    }
    // console.log(json)
    return json
  }
}
