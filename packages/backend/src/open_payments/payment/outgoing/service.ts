import assert from 'assert'
import { parse, end } from 'iso8601-duration'
import * as knex from 'knex'
import {
  ForeignKeyViolationError,
  TransactionOrKnex,
  PartialModelObject
} from 'objection'

import { Pagination } from '../../../shared/baseModel'
import { BaseService } from '../../../shared/baseService'
import {
  FundingError,
  LifecycleError,
  OutgoingPaymentError,
  isOutgoingPaymentError
} from './errors'
import { sendWebhookEvent } from './lifecycle'
import {
  OutgoingPayment,
  PaymentAmount,
  PaymentState,
  PaymentEventType
} from './model'
import { AccountingService } from '../../../accounting/service'
import { AccountService } from '../../account/service'
import {
  Grant,
  GrantAccess,
  AccessType,
  AccessAction,
  AccessLimits
} from '../../grant/service'
import { RatesService } from '../../../rates/service'
import { IlpPlugin, IlpPluginOptions } from './ilp_plugin'
import * as worker from './worker'

export interface OutgoingPaymentService {
  get(id: string): Promise<OutgoingPayment | undefined>
  create(
    options: CreateOutgoingPaymentOptions,
    grant?: Grant
  ): Promise<OutgoingPayment | OutgoingPaymentError>
  update(
    options: UpdateOutgoingPaymentOptions,
    grant?: Grant
  ): Promise<OutgoingPayment | OutgoingPaymentError>
  fund(
    options: FundOutgoingPaymentOptions
  ): Promise<OutgoingPayment | FundingError>
  processNext(): Promise<string | undefined>
  getAccountPage(
    accountId: string,
    pagination?: Pagination
  ): Promise<OutgoingPayment[]>
}

export interface ServiceDependencies extends BaseService {
  knex: TransactionOrKnex
  slippage: number
  quoteLifespan: number // milliseconds
  accountingService: AccountingService
  accountService: AccountService
  ratesService: RatesService
  makeIlpPlugin: (options: IlpPluginOptions) => IlpPlugin
}

export async function createOutgoingPaymentService(
  deps_: ServiceDependencies
): Promise<OutgoingPaymentService> {
  const deps = {
    ...deps_,
    logger: deps_.logger.child({ service: 'OutgoingPaymentService' })
  }
  return {
    get: (id) => getOutgoingPayment(deps, id),
    create: (options: CreateOutgoingPaymentOptions) =>
      createOutgoingPayment(deps, options),
    update: (options) => updatePayment(deps, options),
    fund: (options) => fundPayment(deps, options),
    processNext: () => worker.processPendingPayment(deps),
    getAccountPage: (accountId, pagination) =>
      getAccountPage(deps, accountId, pagination)
  }
}

async function getOutgoingPayment(
  deps: ServiceDependencies,
  id: string
): Promise<OutgoingPayment | undefined> {
  return OutgoingPayment.query(deps.knex)
    .findById(id)
    .withGraphJoined('account.asset')
}

export interface CreateOutgoingPaymentOptions {
  accountId: string
  authorized?: boolean
  sendAmount?: PaymentAmount
  receiveAmount?: PaymentAmount
  receivingAccount?: string
  receivingPayment?: string
  description?: string
  externalRef?: string
}

async function createOutgoingPayment(
  deps: ServiceDependencies,
  options: CreateOutgoingPaymentOptions,
  grant?: Grant
): Promise<OutgoingPayment | OutgoingPaymentError> {
  if (options.receivingPayment) {
    if (options.receivingAccount) {
      return OutgoingPaymentError.InvalidDestination
    }
    if (options.sendAmount || options.receiveAmount) {
      return OutgoingPaymentError.InvalidAmount
    }
  } else if (options.receivingAccount) {
    if (options.sendAmount) {
      if (options.receiveAmount || options.sendAmount.amount <= BigInt(0)) {
        return OutgoingPaymentError.InvalidAmount
      }
    } else if (
      !options.receiveAmount ||
      options.receiveAmount.amount <= BigInt(0)
    ) {
      return OutgoingPaymentError.InvalidAmount
    }
  } else {
    return OutgoingPaymentError.InvalidDestination
  }

  try {
    const account = await deps.accountService.get(options.accountId)
    if (!account) {
      return OutgoingPaymentError.UnknownAccount
    }
    if (options.sendAmount) {
      if (options.sendAmount.assetCode || options.sendAmount.assetScale) {
        if (
          options.sendAmount.assetCode !== account.asset.code ||
          options.sendAmount.assetScale !== account.asset.scale
        ) {
          return OutgoingPaymentError.InvalidAmount
        }
      }
      ;(options.sendAmount.assetCode = account.asset.code),
        (options.sendAmount.assetScale = account.asset.scale)
    }

    return await OutgoingPayment.transaction(deps.knex, async (trx) => {
      const payment = await OutgoingPayment.query(trx)
        .insertAndFetch({
          ...options,
          state: PaymentState.Pending,
          createGrant: grant?.grant
        })
        .withGraphFetched('account.asset')

      if (payment.authorized) {
        await payment.$query(trx).patch({
          authorizeGrant: grant?.grant,
          authorizedAt: payment.createdAt
        })
      }

      if (grant) {
        const validCreate = await validateGrant(
          {
            ...deps,
            knex: trx
          },
          payment,
          grant,
          AccessAction.Create
        )
        if (!validCreate) {
          throw OutgoingPaymentError.InsufficientGrant
        }
        if (payment.authorized) {
          const validAuthorize = await validateGrant(
            {
              ...deps,
              knex: trx
            },
            payment,
            grant,
            AccessAction.Authorize
          )
          if (!validAuthorize) {
            throw OutgoingPaymentError.InsufficientGrant
          }
        }
      }

      await deps.accountingService.createLiquidityAccount({
        id: payment.id,
        asset: payment.account.asset
      })

      return payment
    })
  } catch (err) {
    // if (isOutgoingPaymentError(err)) return err
    if (err instanceof ForeignKeyViolationError) {
      return OutgoingPaymentError.UnknownAccount
    }
    throw err
  }
}

export interface UpdateOutgoingPaymentOptions {
  id: string
  authorized?: boolean
  sendAmount?: PaymentAmount
  receiveAmount?: PaymentAmount
  state?: PaymentState
}

async function updatePayment(
  deps: ServiceDependencies,
  {
    id,
    authorized,
    sendAmount,
    receiveAmount,
    state
  }: UpdateOutgoingPaymentOptions,
  grant?: Grant
): Promise<OutgoingPayment | OutgoingPaymentError> {
  if (!sendAmount && !receiveAmount) {
    if (!authorized) {
      return OutgoingPaymentError.InvalidAmount
    } else if (state) {
      return OutgoingPaymentError.InvalidState
    }
  } else if (sendAmount && receiveAmount) {
    return OutgoingPaymentError.InvalidAmount
  } else if (state && state !== PaymentState.Pending) {
    return OutgoingPaymentError.InvalidState
  }
  if (authorized !== undefined && authorized !== true) {
    return OutgoingPaymentError.InvalidAuthorized
  }
  try {
    return deps.knex.transaction(async (trx) => {
      const payment = await OutgoingPayment.query(trx)
        .findById(id)
        .forUpdate()
        .withGraphFetched('account.asset')
      if (!payment) return OutgoingPaymentError.UnknownPayment

      if (sendAmount || receiveAmount) {
        const update: PartialModelObject<OutgoingPayment> = {}
        switch (payment.state) {
          case PaymentState.Pending:
          case PaymentState.Prepared:
          case PaymentState.Expired:
            update.state = PaymentState.Pending
            update.expiresAt = null
            break
          default:
            return OutgoingPaymentError.WrongState
        }

        if (sendAmount) {
          if (sendAmount.assetCode || sendAmount.assetScale) {
            if (
              sendAmount.assetCode !== payment.account.asset.code ||
              sendAmount.assetScale !== payment.account.asset.scale
            ) {
              return OutgoingPaymentError.InvalidAmount
            }
          }
          update.sendAmount = {
            amount: sendAmount.amount,
            assetCode: payment.account.asset.code,
            assetScale: payment.account.asset.scale
          }
          update.receiveAmount = null
        } else {
          update.receiveAmount = receiveAmount
          update.sendAmount = null
        }
        await payment.$query(trx).patch(update)
      }
      if (authorized) {
        const update: PartialModelObject<OutgoingPayment> = {
          authorized,
          authorizedAt: new Date(),
          authorizeGrant: grant?.grant
        }
        if (payment.state === PaymentState.Prepared) {
          update.state = PaymentState.Funding
          await sendWebhookEvent(
            {
              ...deps,
              knex: trx
            },
            payment,
            PaymentEventType.PaymentFunding
          )
        } else if (
          payment.state !== PaymentState.Pending ||
          payment.authorized
        ) {
          return OutgoingPaymentError.WrongState
        }
        await payment.$query(trx).patch(update)
        if (grant) {
          const validAuthorize = await validateGrant(
            {
              ...deps,
              knex: trx
            },
            payment,
            grant,
            AccessAction.Authorize
          )
          if (!validAuthorize) {
            throw OutgoingPaymentError.InsufficientGrant
          }
          // TODO: if unquoted, store grant
          // overwrite existing grant?
        }
      }
      return payment
    })
  } catch (err) {
    if (isOutgoingPaymentError(err)) return err
    throw err
  }
}

function validateAccessLimits(
  payment: OutgoingPayment,
  limits: AccessLimits,
  time: Date
): boolean {
  return (
    validateTimeLimits(limits, time) &&
    validateReceiverLimits(payment, limits) &&
    validateAmountAssets(payment, limits)
    // TODO: locations
  )
}

function validateTimeLimits(limits: AccessLimits, time: Date): boolean {
  return (
    (!limits.startAt || limits.startAt.getTime() <= time.getTime()) &&
    (!limits.expiresAt || time.getTime() < limits.expiresAt.getTime())
  )
}

function validateReceiverLimits(
  payment: OutgoingPayment,
  limits: AccessLimits
): boolean {
  if (
    limits.receivingAccount &&
    payment.receivingAccount &&
    payment.receivingAccount !== limits.receivingAccount
  ) {
    return false
  }
  return (
    !limits.receivingPayment ||
    payment.receivingPayment === limits.receivingPayment
  )
}

function validateAmountAssets(
  payment: OutgoingPayment,
  limits: AccessLimits
): boolean {
  if (
    limits.sendAmount &&
    // TODO: use payment.asset
    (limits.sendAmount.assetCode !== payment.account.asset.code ||
      limits.sendAmount.assetScale !== payment.account.asset.scale)
  ) {
    return false
  }
  return (
    !limits.receiveAmount ||
    !payment.receiveAmount ||
    (limits.receiveAmount.assetCode === payment.receiveAmount.assetCode &&
      limits.receiveAmount.assetScale === payment.receiveAmount.assetScale)
  )
}

// punt and return true if payment's sendAmount, receiveAmount and/or receivingAccount are unknown
// and cannot be checked.
// In which case, should this return a conditional true?
// Or should authorizing pre-quote do a limited grant check, with the expectation of doing a full check post-quote?
// should that limited check be performed at token introspection and the outgoing payment should only do full checks
// when quoted and authorized?

// when are sendAmount and receiveAmount assets validated?

// "payment" is locked by the "deps.knex" transaction.
async function validateGrant(
  deps: ServiceDependencies,
  payment: OutgoingPayment,
  grant: Grant,
  action: AccessAction
): Promise<boolean> {
  const grantAccess = grant.getAccess({
    type: AccessType.OutgoingPayment,
    action,
    location: deps.accountService.getUrl(payment.accountId)
  })

  if (!grantAccess) {
    // log?
    return false
  }

  let validSendAmount = !payment.sendAmount
  let validReceiveAmount = !payment.receiveAmount

  // what other payments apply to those intervals
  // how much of the other payments' amounts can be applied to other intervals?

  // assert.ok(payment.sendAmount && payment.receiveAmount && payment.authorizedAt)

  // Find access right(s) that authorize this payment (pending send/receive limits).
  // Also track access right(s) to which existing competing
  // payments can be assigned to satisfy send/receive limits.
  const paymentAccess: GrantAccess[] = []
  const otherAccess: GrantAccess[] = []

  const paymentTime = payment.authorizedAt || payment.createdAt
  for (const access of grantAccess) {
    if (!access.limits) {
      return true
    }
    if (validateAccessLimits(payment, access.limits, paymentTime)) {
      if (!access.limits.sendAmount) {
        validSendAmount = true
      }
      if (!access.limits.receiveAmount) {
        validReceiveAmount = true
      }
      if (validSendAmount && validReceiveAmount) {
        return true
      }
      // Store access.limits.interval as current interval's startAt/expiresAt
      if (access.limits?.interval && access.limits?.startAt) {
        // Store all preceding intervals as individual accesses in otherAccess
        let startAt = access.limits.startAt
        const interval = parse(access.limits.interval)
        let expiresAt = end(interval, startAt)
        while (expiresAt.getTime() < paymentTime.getTime()) {
          otherAccess.push({
            ...access,
            limits: {
              ...access.limits,
              startAt,
              expiresAt
            }
          })
          startAt = expiresAt
          expiresAt = end(interval, startAt)
        }
        access.limits = {
          ...access.limits,
          startAt,
          expiresAt
        }
      }
      paymentAccess.push(access)
    } else {
      // Exclude pre-startAt access
      const now = new Date()
      if (
        !access.limits?.startAt ||
        access.limits?.startAt.getTime() <= now.getTime()
      ) {
        otherAccess.push(access)
      }
    }
  }

  if (!paymentAccess) {
    return false
  }

  if (!validSendAmount) {
    assert.ok(payment.sendAmount)
    if (
      paymentAccess.reduce(
        (prev, access) =>
          prev + (access.limits?.sendAmount?.amount ?? BigInt(0)),
        BigInt(0)
      ) < payment.sendAmount.amount
    ) {
      // Payment amount single-handedly exceeds sendAmount limit(s)
      return false
    }
  }

  if (!validReceiveAmount) {
    assert.ok(payment.receiveAmount)
    if (
      paymentAccess.reduce(
        (prev, access) =>
          prev + (access.limits?.receiveAmount?.amount ?? BigInt(0)),
        BigInt(0)
      ) < payment.receiveAmount.amount
    ) {
      // Payment amount single-handedly exceeds receiveAmount limit(s)
      return false
    }
  }

  const whereGrant =
    action === AccessAction.Create
      ? { creatGrant: payment.createGrant }
      : { authorizeGrant: payment.authorizeGrant }

  const existingPayments = await OutgoingPayment.query(deps.knex)
    // Ensure the payments cannot be processed concurrently by multiple workers.
    // .forUpdate()  // why do these need to be locked?
    .where(whereGrant)
    .andWhereNot({
      id: payment.id
    })
    .andWhere((builder: knex.QueryBuilder) => {
      builder
        // Only check existing *authorized* (and quoted) payments
        // (which happens to prevent deadlocking)
        .whereIn('state', [
          PaymentState.Funding,
          PaymentState.Sending,
          PaymentState.Completed
        ])
        .orWhereNot('sentAmount', 0)
    })

  if (!existingPayments) {
    return true
  }

  // const competingPayments: Record<string, OutgoingPayment[]> = {}

  // for (const action in paymentAccess) {
  //   competingPayments[action] = existingPayments.filter(payment => {
  //     if (action === AccessAction.Authorize && !payment.authorized) { // ????
  //       return false
  //     }
  //     const time = payment.authorizedAt //|| payment.createdAt
  //     if (!access.limits || validateAccessLimits(payment, limits, time)) {
  //       return true
  //     }
  //     return false
  //   })
  //   if (!competingPayments[action]) {
  //     // The payment may use the entire send limit (for this action)
  //     delete paymentAccess[action]
  //     if (!paymentAccess) {
  //       return true
  //     }
  //   }
  // }

  // Do paymentAccess rights support payment and applicable existing payments?

  // Attempt to assign existing payment(s) to other access(es) first

  return false
}

export interface FundOutgoingPaymentOptions {
  id: string
  amount: bigint
  transferId: string
}

async function fundPayment(
  deps: ServiceDependencies,
  { id, amount, transferId }: FundOutgoingPaymentOptions
): Promise<OutgoingPayment | FundingError> {
  return deps.knex.transaction(async (trx) => {
    const payment = await OutgoingPayment.query(trx)
      .findById(id)
      .forUpdate()
      .withGraphFetched('account.asset')
    if (!payment) return FundingError.UnknownPayment
    if (payment.state !== PaymentState.Funding) {
      return FundingError.WrongState
    }
    if (!payment.sendAmount) throw LifecycleError.MissingSendAmount
    if (amount !== payment.sendAmount.amount) return FundingError.InvalidAmount
    const error = await deps.accountingService.createDeposit({
      id: transferId,
      account: payment,
      amount
    })
    if (error) {
      return error
    }
    await payment.$query(trx).patch({ state: PaymentState.Sending })
    return payment
  })
}

async function getAccountPage(
  deps: ServiceDependencies,
  accountId: string,
  pagination?: Pagination
): Promise<OutgoingPayment[]> {
  return await OutgoingPayment.query(deps.knex)
    .getPage(pagination)
    .where({ accountId })
}
