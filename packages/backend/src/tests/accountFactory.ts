import { v4 as uuid } from 'uuid'

import {
  AccountService,
  CreateOptions,
  CreateSubAccountOptions,
  Account
} from '../account/service'
import { randomAsset } from './asset'

export function isSubAccount(
  account: Partial<CreateOptions>
): account is CreateSubAccountOptions {
  return (account as CreateSubAccountOptions).superAccountId !== undefined
}

export class AccountFactory {
  public constructor(public accounts: AccountService) {}

  public async build(options: Partial<CreateOptions> = {}): Promise<Account> {
    let accountOptions: CreateOptions
    if (isSubAccount(options)) {
      accountOptions = {
        id: options.id || uuid(),
        disabled: options.disabled || false,
        superAccountId: options.superAccountId,
        stream: {
          enabled: options.stream?.enabled || false
        }
      }
    } else {
      accountOptions = {
        id: options.id || uuid(),
        disabled: options.disabled || false,
        asset: options.asset || randomAsset(),
        stream: {
          enabled: options.stream?.enabled || false
        }
      }
    }
    if (options.maxPacketAmount) {
      accountOptions.maxPacketAmount = options.maxPacketAmount
    }
    if (options.http) {
      accountOptions.http = options.http
    }
    if (options.routing) {
      accountOptions.routing = options.routing
    }
    const account = await this.accounts.create(accountOptions)
    return account as Account
  }
}
