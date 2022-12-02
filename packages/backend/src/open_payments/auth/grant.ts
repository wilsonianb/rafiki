import assert from 'assert'
import { Introspection, TokenInfo } from 'auth'
import { Interval, Duration, DateTime, Settings } from 'luxon'

import { Amount, parseAmount } from '../amount'

Settings.defaultZone = 'utc'

// export type AccessType = TokenInfo['access']['type']
export enum AccessType {
  IncomingPayment = 'incoming-payment',
  OutgoingPayment = 'outgoing-payment',
  Quote = 'quote'
}

export enum AccessAction {
  Create = 'create',
  Read = 'read',
  ReadAll = 'read-all',
  Complete = 'complete',
  List = 'list',
  ListAll = 'list-all'
}

export interface AccessLimits {
  receiver?: string
  sendAmount?: Amount
  receiveAmount?: Amount
  interval?: string
}

// export interface GrantAccess {
//   type: AccessType
//   actions: AccessAction[]
//   identifier?: string
//   limits?: AccessLimits
// }

type GrantAccess = Omit<TokenInfo['access'][number], 'limits'> & {
  limits?: AccessLimits
}

export interface GrantOptions {
  grant: string
  client: string
  access: GrantAccess[]
}

export class Grant {
  static fromTokenInfo(tokenInfo: TokenInfo): Grant | undefined {
    if (!tokenInfo.active) {
      return undefined
    }
    return new this({
      grant: tokenInfo.grant,
      client: tokenInfo.client,
      access: tokenInfo.access.map((access) => {
        switch(access.type) {
          case AccessType.IncomingPayment: {
            return {
              type: AccessType.IncomingPayment,
              actions: access.actions,
              identifier: access.identifier
            }
          }
          case AccessType.OutgoingPayment: {
            return {
              type: AccessType.OutgoingPayment,
              actions: access.actions,
              identifier: access.identifier,
              limits: access.limits && {
                ...access.limits,
                sendAmount: access.limits.sendAmount && parseAmount(access.limits.sendAmount),
                receiveAmount: access.limits.receiveAmount && parseAmount(access.limits.receiveAmount)
              }
            }
          }
          case AccessType.Quote: {
            return {
              type: AccessType.Quote,
              actions: access.actions
            }
          }
        }
      })
    })
  }

  constructor(options: GrantOptions) {
    this.grant = options.grant
    this.access = options.access
    this.client = options.client
  }

  public readonly grant: string
  public readonly access: GrantAccess[]
  public readonly client: string

  public findAccess({
    type,
    action,
    identifier
  }: {
    type: AccessType
    action: AccessAction
    identifier: string
  }): GrantAccess | undefined {
    return this.access?.find(
      (access) =>
        access.type == type &&
        (!access.identifier || access.identifier === identifier) &&
        (access.actions.includes(action) ||
          (action === AccessAction.Read &&
            access.actions.includes(AccessAction.ReadAll)) ||
          (action === AccessAction.List &&
            access.actions.includes(AccessAction.ListAll)))
    )
  }

  public toTokenInfo(): TokenInfo {
    return {
      active: true,
      grant: this.grant,
      client: this.client,
      access: this.access?.map((access) => {
        return {
          ...access,
          limits: access.limits && {
            ...access.limits,
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

// Export for testing
export function getInterval(
  repeatingInterval: string,
  target: Date
): Interval | undefined {
  const parts = repeatingInterval.split('/')
  assert.ok(parts.length === 3)

  let repetitions: number | undefined
  if (parts[0].length > 1 && parts[0][1] !== '-') {
    repetitions = Number(parts[0].slice(1))
  } else if (['R', 'R-1'].includes(parts[0])) {
    repetitions = Infinity
  }
  if (repetitions === undefined || isNaN(repetitions)) return

  let interval = Interval.fromISO(`${parts[1]}/${parts[2]}`)
  if (!interval.isValid || !interval.start) return
  if (interval.contains(DateTime.fromJSDate(target))) return interval

  let duration: Duration
  let forward: boolean
  if (parts[1].length > 1 && parts[1][0] === 'P') {
    duration = Duration.fromISO(parts[1])
    forward = false
  } else if (parts[2].length > 1 && parts[2][0] === 'P') {
    duration = Duration.fromISO(parts[2])
    forward = true
  } else {
    duration = Duration.fromISO(interval.toDuration().toString())
    forward = true
  }

  if (forward && interval.isAfter(DateTime.fromJSDate(target))) return undefined
  if (!forward && interval.isBefore(DateTime.fromJSDate(target)))
    return undefined

  for (let i = 1; i < repetitions + 1; i++) {
    let nextInterval: Interval
    if (forward) {
      nextInterval = Interval.after(interval.end, duration)
    } else {
      nextInterval = Interval.before(interval.start, duration)
    }
    if (nextInterval.contains(DateTime.fromJSDate(target))) return nextInterval
    interval = nextInterval
  }
}
