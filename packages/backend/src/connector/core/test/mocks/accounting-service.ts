import { isPeer, AccountingService } from '../../rafiki'

import { Transaction } from '../../../../accounting/service'
import { TransferError } from '../../../../accounting/errors'
import { Account } from '../../../../open_payments/account/model'
import { Invoice } from '../../../../open_payments/invoice/model'
import { OutgoingPayment } from '../../../../outgoing_payment/model'
import { Peer } from '../../../../peer/model'

export type MockAccount = Account & {
  balance: bigint
}

export type MockInvoice = Invoice & {
  balance: bigint
}

export type MockPayment = OutgoingPayment & {
  balance: bigint
}

export type MockPeer = Peer & {
  incomingAuthToken?: string
  balance: bigint
}

export type MockIncomingAccount = MockPayment | MockPeer

export type MockOutgoingAccount = MockAccount | MockInvoice | MockPeer

type MockIlpAccount = MockIncomingAccount | MockOutgoingAccount

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
const isIncomingPeer = (o: any): o is MockPeer => o.incomingAuthToken

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
const isInvoice = (o: any): o is Invoice => o.active !== undefined

export class MockAccountingService implements AccountingService {
  private accounts: Map<string, MockIlpAccount> = new Map()

  async _getInvoice(invoiceId: string): Promise<Invoice | undefined> {
    return await Invoice.query()
      .resolve(
        this.find((account) => account.id === invoiceId && isInvoice(account))
      )
      .first()
  }

  async _getAccount(accountId: string): Promise<Account | undefined> {
    return await Account.query()
      .resolve(
        this.find((account) => account.id === accountId && !isInvoice(account))
      )
      .first()
  }

  async _getByDestinationAddress(
    destinationAddress: string
  ): Promise<Peer | undefined> {
    return await Peer.query()
      .resolve(
        this.find((account) => {
          return (
            isPeer(account) &&
            destinationAddress.startsWith(account.staticIlpAddress)
          )
        })
      )
      .first()
  }

  async _getByIncomingToken(token: string): Promise<Peer | undefined> {
    return await Peer.query()
      .resolve(
        this.find(
          (account) =>
            isIncomingPeer(account) && account.incomingAuthToken === token
        )
      )
      .first()
  }

  async getBalance(accountId: string): Promise<bigint | undefined> {
    const account = this.accounts.get(accountId)
    if (account) {
      return account.balance
    }
  }

  async getTotalReceived(accountId: string): Promise<bigint | undefined> {
    return await this.getBalance(accountId)
  }

  async create(account: MockIlpAccount): Promise<MockIlpAccount> {
    if (!account.id) throw new Error('unexpected asset account')
    this.accounts.set(account.id, account)
    return account
  }

  async createTransfer({
    sourceAccount,
    destinationAccount,
    sourceAmount,
    destinationAmount
  }: {
    sourceAccount: MockIncomingAccount
    destinationAccount: MockOutgoingAccount
    sourceAmount: bigint
    destinationAmount: bigint
    timeout: bigint
  }): Promise<Transaction | TransferError> {
    if (sourceAccount.balance < sourceAmount) {
      return TransferError.InsufficientBalance
    }
    sourceAccount.balance -= sourceAmount
    return {
      commit: async () => {
        destinationAccount.balance += destinationAmount
      },
      rollback: async () => {
        sourceAccount.balance += sourceAmount
      }
    }
  }

  private find(
    predicate: (account: MockIlpAccount) => boolean
  ): MockIlpAccount | undefined {
    for (const [, account] of this.accounts) {
      if (predicate(account)) return account
    }
  }
}
