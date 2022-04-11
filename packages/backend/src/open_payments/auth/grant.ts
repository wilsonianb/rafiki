import assert from 'assert'

import { Amount } from '../payment/amount'

interface AmountJSON {
  value: string
  assetCode: string
  assetScale: number
}

export enum AccessType {
  Account = 'account',
  IncomingPayment = 'incoming-payment',
  OutgoingPayment = 'outgoing-payment'
}

export enum AccessAction {
  Create = 'create',
  Authorize = 'authorize',
  Read = 'read',
  Update = 'update'
}

export interface AccessLimits {
  interval?: string
  startAt?: Date
  expiresAt?: Date
  receivingAccount?: string
  receivingPayment?: string
  sendAmount?: Amount
  receiveAmount?: Amount
}

interface AccessLimitsJSON {
  interval?: string
  startAt?: string
  expiresAt?: string
  receivingAccount?: string
  receivingPayment?: string
  sendAmount?: AmountJSON
  receiveAmount?: AmountJSON
}

export interface GrantAccess {
  type: AccessType
  actions: AccessAction[]
  locations?: string[]
  identifier?: string
  limits?: AccessLimits
}

export type GrantAccessJSON = Omit<GrantAccess, 'limits'> & {
  limits?: AccessLimitsJSON
}

export interface GrantOptions {
  active: boolean
  grant: string
  access?: GrantAccess[]
}

export type GrantJSON = Omit<GrantOptions, 'access'> & {
  access?: GrantAccessJSON[]
}

export class Grant {
  constructor(options: GrantOptions) {
    assert.ok(options.access || !options.active)
    this.active = options.active
    this.grant = options.grant
    this.access = options.access || []
  }

  public readonly active: boolean
  public readonly grant: string
  public readonly access: GrantAccess[]

  public includesAccess({
    type,
    action,
    identifier
  }: {
    type: AccessType
    action: AccessAction
    identifier: string
  }): boolean {
    return !!this.access?.find(
      (access) =>
        access.type === type &&
        (!access.identifier || access.identifier === identifier) &&
        access.actions.includes(action)
    )
  }

  public toJSON(): GrantJSON {
    return {
      active: this.active,
      grant: this.grant,
      access: this.access?.map((access) => {
        return {
          ...access,
          limits: access.limits && {
            ...access.limits,
            startAt: access.limits.startAt?.toISOString(),
            expiresAt: access.limits.expiresAt?.toISOString(),
            sendAmount: access.limits.sendAmount && {
              ...access.limits.sendAmount,
              value: access.limits.sendAmount.value.toString()
            },
            receiveAmount: access.limits.receiveAmount && {
              ...access.limits.receiveAmount,
              value: access.limits.receiveAmount.value.toString()
            }
          }
        }
      })
    }
  }
}
