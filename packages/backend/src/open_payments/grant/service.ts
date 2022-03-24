import assert from 'assert'
import axios from 'axios'

import { BaseService } from '../../shared/baseService'

export interface GrantService {
  get(token: string): Promise<Grant | undefined>
}

interface ServiceDependencies extends BaseService {
  tokenIntrospectionUrl: string
}

export async function createGrantService({
  logger,
  tokenIntrospectionUrl
}: ServiceDependencies): Promise<GrantService> {
  const log = logger.child({
    service: 'GrantService'
  })
  const deps: ServiceDependencies = {
    logger: log,
    tokenIntrospectionUrl
  }
  return {
    get: (token) => getGrant(deps, token)
  }
}

async function getGrant(
  deps: ServiceDependencies,
  token: string
): Promise<Grant | undefined> {
  try {
    // https://datatracker.ietf.org/doc/html/draft-ietf-gnap-resource-servers#section-3.3
    const requestHeaders = {
      'Content-Type': 'application/json'
      // TODO:
      // 'Signature-Input': 'sig1=...'
      // 'Signature': 'sig1=...'
      // 'Digest': 'sha256=...'
    }

    const { data } = await axios.post(
      deps.tokenIntrospectionUrl,
      {
        access_token: token
        // TODO:
        // proof: 'httpsig',
        // resource_server: '7C7C4AZ9KHRS6X63AJAO'
      },
      {
        headers: requestHeaders,
        validateStatus: (status) => status === 200
      }
    )
    // TODO: validate data is grant
    assert.ok(data.active !== undefined)
    assert.ok(data.grant)
    const options: GrantOptions = {
      active: data.active,
      grant: data.grant
    }
    if (data.access) {
      options.access = data.access.map(
        (access: GrantAccessJson): GrantAccess => {
          const options: GrantAccess = {
            type: access.type,
            actions: access.actions,
            locations: access.locations
          }
          if (access.limits) {
            options.limits = {
              interval: access.limits.interval,
              receivingAccount: access.limits.receivingAccount,
              receivingPayment: access.limits.receivingPayment
            }
            if (access.limits.startAt) {
              options.limits.startAt = new Date(access.limits.startAt)
            }
            if (access.limits.expiresAt) {
              options.limits.expiresAt = new Date(access.limits.expiresAt)
            }
            if (access.limits.sendAmount) {
              options.limits.sendAmount = {
                amount: BigInt(access.limits.sendAmount.amount),
                assetCode: access.limits.sendAmount.assetCode,
                assetScale: access.limits.sendAmount.assetScale
              }
            }
            if (access.limits.receiveAmount) {
              options.limits.receiveAmount = {
                amount: BigInt(access.limits.receiveAmount.amount),
                assetCode: access.limits.receiveAmount.assetCode,
                assetScale: access.limits.receiveAmount.assetScale
              }
            }
          }
          return options
        }
      )
    }
    return new Grant(options)
  } catch (err) {
    return
  }
}

export interface Amount {
  amount: bigint
  assetCode?: string
  assetScale?: number
}

interface AmountJSON {
  amount: string
  assetCode?: string
  assetScale?: number
}

export enum AccessType {
  Account = 'account',
  IncomingPayment = 'incoming-payment',
  OutgoingPayment = 'outgoing-payment'
}

// export enum OutgoingPaymentAction {
export enum AccessAction {
  Create = 'create',
  Authorize = 'authorize',
  Read = 'read'
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
  locations: string[]
  limits?: AccessLimits
}

type GrantAccessJson = Omit<GrantAccess, 'limits'> & {
  limits?: AccessLimitsJSON
}

export interface GrantOptions {
  active: boolean
  grant: string
  access?: GrantAccess[]
}

type GrantJSON = Omit<GrantOptions, 'access'> & {
  access?: GrantAccessJson[]
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
    location,
    actions
  }: {
    type: AccessType
    location: string
    actions: AccessAction[]
  }): boolean {
    if (!this.access) {
      return false
    }

    const includedActions: Record<string, boolean> = {}
    actions.forEach((action) => (includedActions[action] = false))

    const now = new Date()
    const typeAccess = this.getAccess({ type, location })
    for (const access of typeAccess) {
      if (
        access.limits?.startAt &&
        now.getTime() < access.limits?.startAt.getTime()
      ) {
        continue
      }
      if (
        access.limits?.expiresAt &&
        access.limits?.expiresAt.getTime() <= now.getTime()
      ) {
        continue
      }
      for (const action of actions) {
        if (access.actions.includes(action)) {
          includedActions[action] = true
          if (
            !Object.values(includedActions).filter(
              (included: boolean) => !included
            )
          ) {
            return true
          }
        }
      }
    }
    return false
  }

  public getAccess({
    type,
    location,
    action
  }: {
    type?: AccessType
    location?: string
    action?: AccessAction
  }): GrantAccess[] {
    return this.access.filter((access) => {
      if (type && access.type !== type) {
        return false
      }
      if (location && !access.locations.includes(location)) {
        return false
      }
      if (action && !access.actions.includes(action)) {
        return false
      }
      return true
    })
  }

  public toJSON(): GrantJSON {
    return {
      active: this.active,
      grant: this.grant,
      access: this.access?.map((access) => {
        return {
          type: access.type,
          actions: access.actions,
          locations: access.locations,
          limits: access.limits && {
            ...access.limits,
            startAt: access.limits.startAt?.toISOString(),
            expiresAt: access.limits.expiresAt?.toISOString(),
            sendAmount: access.limits.sendAmount && {
              ...access.limits.sendAmount,
              amount: access.limits.sendAmount.amount.toString()
            },
            receiveAmount: access.limits.receiveAmount && {
              ...access.limits.receiveAmount,
              amount: access.limits.receiveAmount.amount.toString()
            }
          }
        }
      })
    }
  }
}
