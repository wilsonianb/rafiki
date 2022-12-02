import assert from 'assert'
import { Access, AccessLimits as OpenPaymentsLimits, TokenInfo } from 'auth'
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

export const findAccess = (
  tokenInfo: TokenInfo,
  access: {
    type: AccessType
    action: AccessAction
    identifier: string
  }
): Access | undefined =>
  tokenInfo.access?.find(
    (tokenAccess) =>
      tokenAccess.type == access.type &&
      (!tokenAccess['identifier'] ||
        tokenAccess['identifier'] === access.identifier) &&
      tokenAccess.actions.find(
        (action) =>
          action == access.action ||
          (access.action === AccessAction.Read &&
            action == AccessAction.ReadAll) ||
          (access.action === AccessAction.List &&
            action == AccessAction.ListAll)
      )
  )

export const parseAccessLimits = (
  limits: OpenPaymentsLimits
): AccessLimits => ({
  ...limits,
  sendAmount: limits.sendAmount && parseAmount(limits.sendAmount),
  receiveAmount: limits.receiveAmount && parseAmount(limits.receiveAmount)
})

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
