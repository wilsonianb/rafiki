import assert from 'assert'
import axios from 'axios'
import { parse, end } from 'iso8601-duration'

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
    return new Grant(data)
  } catch (err) {
    return
  }
}

export interface Amount {
  amount: bigint
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
  startAt?: string
  expiresAt?: string
  receivingPayment?: string
  sendAmount?: Amount
}

export interface GrantAccess {
  type: AccessType
  actions: AccessAction[]
  locations: string[]
  limits?: AccessLimits
}

interface GrantOptions {
  active: boolean
  grant: string
  access?: GrantAccess[]
}

class Grant {
  constructor(options: GrantOptions) {
    assert.ok(options.access || !options.active)
    this.active = options.active
    this.grant = options.grant
    this.access = options.access
  }

  public readonly active: boolean
  public readonly grant: string
  public readonly access?: GrantAccess[]

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

    const now = new Date().toISOString()
    for (const access of this.access) {
      // TODO: check limits.receivingPayment?
      if (
        access.type === type &&
        // startsWith?
        access.locations.includes(location)
      ) {
        if (access.limits?.startAt) {
          if (now < access.limits?.startAt) {
            continue
          }
          if (access.limits.interval) {
            const intervalEnd = end(
              parse(access.limits.interval),
              new Date(access.limits?.startAt)
            )
            if (intervalEnd.toISOString() <= now) {
              continue
            }
          }
        }
        if (access.limits?.expiresAt && access.limits?.expiresAt <= now) {
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
    }
    return false
  }

  // getSendAmountLimits
}
