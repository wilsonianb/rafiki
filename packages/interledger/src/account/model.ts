import { BaseModel } from '../shared/baseModel'
import { Asset } from '../asset/model'
import { HttpToken } from '../httpToken/model'
import { Model, Pojo } from 'objection'

export class IlpAccount extends BaseModel {
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
    },
    subAccounts: {
      relation: Model.HasManyRelation,
      modelClass: IlpAccount,
      join: {
        from: 'accounts.id',
        to: 'accounts.superAccountId'
      }
    },
    superAccount: {
      relation: Model.HasOneRelation,
      modelClass: IlpAccount,
      join: {
        from: 'accounts.superAccountId',
        to: 'accounts.id'
      }
    },
    incomingTokens: {
      relation: Model.HasManyRelation,
      modelClass: HttpToken,
      join: {
        from: 'accounts.id',
        to: 'httpTokens.accountId'
      }
    }
  }

  public readonly disabled!: boolean

  public readonly assetId!: string
  public asset!: Asset
  // TigerBeetle account id tracking Interledger balance
  public readonly balanceId!: string
  // TigerBeetle account id tracking credit extended by super-account
  public readonly creditBalanceId?: string
  // TigerBeetle account id tracking credit extended to sub-account(s)
  public readonly creditExtendedBalanceId?: string
  // TigerBeetle account id tracking amount loaned from super-account
  public readonly debtBalanceId?: string
  // TigerBeetle account id tracking amount(s) loaned to sub-account(s)
  public readonly lentBalanceId?: string

  public readonly superAccountId?: string
  public readonly subAccounts?: IlpAccount[]
  public readonly superAccount?: IlpAccount

  public readonly maxPacketAmount!: bigint

  public readonly incomingTokens?: HttpToken[]
  public readonly http?: {
    outgoing: {
      authToken: string
      endpoint: string
    }
  }

  public readonly stream!: {
    enabled: boolean
  }

  public readonly routing?: {
    staticIlpAddress: string
  }

  $formatDatabaseJson(json: Pojo): Pojo {
    if (json.stream) {
      json.streamEnabled = json.stream.enabled
      delete json.stream
    }
    if (json.http?.outgoing) {
      json.outgoingToken = json.http.outgoing.authToken
      json.outgoingEndpoint = json.http.outgoing.endpoint
      delete json.http
    }
    if (json.routing) {
      json.staticIlpAddress = json.routing.staticIlpAddress
      delete json.routing
    }
    return super.$formatDatabaseJson(json)
  }

  $parseDatabaseJson(json: Pojo): Pojo {
    const formattedJson = super.$parseDatabaseJson(json)
    if (formattedJson.streamEnabled !== null) {
      formattedJson.stream = {
        enabled: formattedJson.streamEnabled
      }
      delete formattedJson.streamEnabled
    }
    if (formattedJson.outgoingToken) {
      formattedJson.http = {
        outgoing: {
          authToken: formattedJson.outgoingToken,
          endpoint: formattedJson.outgoingEndpoint
        }
      }
      delete formattedJson.outgoingToken
      delete formattedJson.outgoingEndpoint
    }
    if (formattedJson.staticIlpAddress) {
      formattedJson.routing = {
        staticIlpAddress: formattedJson.staticIlpAddress
      }
      delete formattedJson.staticIlpAddress
    }
    return formattedJson
  }

  public isSubAccount(): this is SubAccount {
    return !!this.superAccount
  }

  public hasSuperAccount(id: string): this is SubAccount {
    for (
      let account = this as IlpAccount;
      account.isSubAccount();
      account = account.superAccount
    ) {
      if (account.superAccount.id === id) {
        return true
      }
    }
    return false
  }
}

export interface SubAccount extends IlpAccount {
  superAccount: IlpAccount
}
