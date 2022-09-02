import {
  IncomingPayment,
  IncomingPaymentEvent,
  IncomingPaymentEventType,
  IncomingPaymentState
} from './model'
import { AccountingService } from '../../../accounting/service'
import { Pagination } from '../../../shared/baseModel'
import { BaseService } from '../../../shared/baseService'
import assert from 'assert'
import { Knex } from 'knex'
import { ForeignKeyViolationError, TransactionOrKnex } from 'objection'
import { PaymentPointerService } from '../../payment_pointer/service'
import { Amount } from '../../amount'
import { IncomingPaymentError, isIncomingPaymentError } from './errors'
import { end, parse } from 'iso8601-duration'

export const POSITIVE_SLIPPAGE = BigInt(1)
// First retry waits 10 seconds
// Second retry waits 20 (more) seconds
// Third retry waits 30 (more) seconds, etc. up to 60 seconds
export const RETRY_BACKOFF_MS = 10_000
// TODO: make expiry date configurable
export const EXPIRY = parse('P90D') // 90 days in future

export interface CreateIncomingPaymentOptions {
  paymentPointerId: string
  description?: string
  expiresAt?: Date
  incomingAmount?: Amount
  externalRef?: string
}

export interface IncomingPaymentService {
  get(id: string): Promise<IncomingPayment | undefined>
  create(
    options: CreateIncomingPaymentOptions,
    trx?: Knex.Transaction
  ): Promise<IncomingPayment | IncomingPaymentError>
  complete(id: string): Promise<IncomingPayment | IncomingPaymentError>
  getPaymentPointerPage(
    paymentPointerId: string,
    pagination?: Pagination
  ): Promise<IncomingPayment[]>
  processNext(): Promise<string | undefined>
  getByConnection(connectionId: string): Promise<IncomingPayment | undefined>
}

export interface ServiceDependencies extends BaseService {
  knex: TransactionOrKnex
  accountingService: AccountingService
  paymentPointerService: PaymentPointerService
}

export async function createIncomingPaymentService(
  deps_: ServiceDependencies
): Promise<IncomingPaymentService> {
  const log = deps_.logger.child({
    service: 'IncomingPaymentService'
  })
  const deps: ServiceDependencies = {
    ...deps_,
    logger: log
  }
  return {
    get: (id) => getIncomingPayment(deps, 'id', id),
    create: (options, trx) => createIncomingPayment(deps, options, trx),
    complete: (id) => completeIncomingPayment(deps, id),
    getPaymentPointerPage: (paymentPointerId, pagination) =>
      getPaymentPointerPage(deps, paymentPointerId, pagination),
    processNext: () => processNextIncomingPayment(deps),
    getByConnection: (connectionId) =>
      getIncomingPayment(deps, 'connectionId', connectionId)
  }
}

async function getIncomingPayment(
  deps: ServiceDependencies,
  key: string,
  value: string
): Promise<IncomingPayment | undefined> {
  const incomingPayment = await IncomingPayment.query(deps.knex)
    .findOne(key, value)
    .withGraphFetched('paymentPointer.asset')
  if (incomingPayment) return await addReceivedAmount(deps, incomingPayment)
  else return
}

async function createIncomingPayment(
  deps: ServiceDependencies,
  {
    paymentPointerId,
    description,
    expiresAt,
    incomingAmount,
    externalRef
  }: CreateIncomingPaymentOptions,
  trx?: Knex.Transaction
): Promise<IncomingPayment | IncomingPaymentError> {
  if (!expiresAt) {
    expiresAt = end(EXPIRY)
  } else if (expiresAt.getTime() <= Date.now()) {
    return IncomingPaymentError.InvalidExpiry
  }
  if (incomingAmount && incomingAmount.value <= 0) {
    return IncomingPaymentError.InvalidAmount
  }
  const invTrx = trx || (await IncomingPayment.startTransaction(deps.knex))
  try {
    const incomingPayment = await IncomingPayment.query(invTrx)
      .insertAndFetch({
        paymentPointerId,
        description,
        expiresAt,
        incomingAmount,
        externalRef,
        state: IncomingPaymentState.Pending,
        processAt: expiresAt
      })
      .withGraphFetched('paymentPointer.asset')
    if (incomingAmount) {
      if (
        incomingAmount.assetCode !==
          incomingPayment.paymentPointer.asset.code ||
        incomingAmount.assetScale !== incomingPayment.paymentPointer.asset.scale
      ) {
        throw IncomingPaymentError.InvalidAmount
      }
    }
    if (!trx) {
      await invTrx.commit()
    }
    return await addReceivedAmount(deps, incomingPayment, BigInt(0))
  } catch (err) {
    if (!trx) {
      await invTrx.rollback()
    }
    if (
      err instanceof ForeignKeyViolationError &&
      err.constraint === 'incomingpayments_paymentpointerid_foreign'
    ) {
      return IncomingPaymentError.UnknownPaymentPointer
    } else if (isIncomingPaymentError(err)) {
      return err
    }
    throw err
  }
}

// Fetch (and lock) an incoming payment for work.
// Returns the id of the processed incoming payment (if any).
async function processNextIncomingPayment(
  deps_: ServiceDependencies
): Promise<string | undefined> {
  return deps_.knex.transaction(async (trx) => {
    const now = new Date(Date.now()).toISOString()
    const incomingPayments = await IncomingPayment.query(trx)
      .limit(1)
      // Ensure the incoming payments cannot be processed concurrently by multiple workers.
      .forUpdate()
      // If an incoming payment is locked, don't wait — just come back for it later.
      .skipLocked()
      .where('processAt', '<=', now)
      .withGraphFetched('paymentPointer.asset')

    const incomingPayment = incomingPayments[0]
    if (!incomingPayment) return

    const deps = {
      ...deps_,
      knex: trx,
      logger: deps_.logger.child({
        incomingPayment: incomingPayment.id
      })
    }
    if (
      incomingPayment.state === IncomingPaymentState.Expired ||
      incomingPayment.state === IncomingPaymentState.Completed
    ) {
      await handleDeactivated(deps, incomingPayment)
    } else {
      await handleExpired(deps, incomingPayment)
    }
    return incomingPayment.id
  })
}

// Deactivate expired incoming payments that have some money.
// Delete expired incoming payments that have never received money.
async function handleExpired(
  deps: ServiceDependencies,
  incomingPayment: IncomingPayment
): Promise<void> {
  const amountReceived = await deps.accountingService.getTotalReceived(
    incomingPayment.id
  )
  if (amountReceived) {
    deps.logger.trace(
      { amountReceived },
      'deactivating expired incoming payment'
    )
    await incomingPayment.$query(deps.knex).patch({
      state: IncomingPaymentState.Expired,
      // Add 30 seconds to allow a prepared (but not yet fulfilled/rejected) packet to finish before sending webhook event.
      processAt: new Date(Date.now() + 30_000)
    })
  } else {
    deps.logger.debug({ amountReceived }, 'deleting expired incoming payment')
    await incomingPayment.$query(deps.knex).delete()
  }
}

// Create webhook event to withdraw deactivated incoming payments' liquidity.
async function handleDeactivated(
  deps: ServiceDependencies,
  incomingPayment: IncomingPayment
): Promise<void> {
  assert.ok(incomingPayment.processAt)
  try {
    const amountReceived = await deps.accountingService.getTotalReceived(
      incomingPayment.id
    )
    if (!amountReceived) {
      deps.logger.warn(
        { amountReceived },
        'deactivated incoming payment and empty balance'
      )
      await incomingPayment.$query(deps.knex).patch({ processAt: null })
      return
    }

    const type =
      incomingPayment.state == IncomingPaymentState.Expired
        ? IncomingPaymentEventType.IncomingPaymentExpired
        : IncomingPaymentEventType.IncomingPaymentCompleted
    deps.logger.trace({ type }, 'creating incoming payment webhook event')

    await IncomingPaymentEvent.query(deps.knex).insertAndFetch({
      type,
      data: incomingPayment.toData(amountReceived),
      withdrawal: {
        accountId: incomingPayment.id,
        assetId: incomingPayment.asset.id,
        amount: amountReceived
      }
    })

    await incomingPayment.$query(deps.knex).patch({
      processAt: null
    })
  } catch (error) {
    deps.logger.warn({ error }, 'webhook event creation failed; retrying')
  }
}

async function getPaymentPointerPage(
  deps: ServiceDependencies,
  paymentPointerId: string,
  pagination?: Pagination
): Promise<IncomingPayment[]> {
  const page = await IncomingPayment.query(deps.knex)
    .getPage(pagination)
    .where({
      paymentPointerId
    })
    .withGraphFetched('paymentPointer.asset')

  const amounts = await deps.accountingService.getAccountsTotalReceived(
    page.map((payment: IncomingPayment) => payment.id)
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
  return page.map((payment: IncomingPayment, i: number) => {
    try {
      payment.receivedAmount = {
        value: amounts[i] || BigInt(0),
        assetCode: payment.asset.code,
        assetScale: payment.asset.scale
      }
    } catch (_) {
      deps.logger.error(
        { payment: payment.id },
        'incoming payment account not found'
      )
      throw new Error(
        `Underlying TB account not found, incoming payment id: ${payment.id}`
      )
    }
    return payment
  })
}

async function completeIncomingPayment(
  deps: ServiceDependencies,
  id: string
): Promise<IncomingPayment | IncomingPaymentError> {
  return deps.knex.transaction(async (trx) => {
    const payment = await IncomingPayment.query(trx)
      .findById(id)
      .forUpdate()
      .withGraphFetched('paymentPointer.asset')
    if (!payment) return IncomingPaymentError.UnknownPayment
    if (
      ![IncomingPaymentState.Pending, IncomingPaymentState.Processing].includes(
        payment.state
      )
    ) {
      return IncomingPaymentError.WrongState
    }
    await payment.$query(trx).patch({
      state: IncomingPaymentState.Completed,
      processAt: new Date(Date.now() + 30_000)
    })
    return await addReceivedAmount(deps, payment)
  })
}

async function addReceivedAmount(
  deps: ServiceDependencies,
  payment: IncomingPayment,
  value?: bigint
): Promise<IncomingPayment> {
  const received =
    value ?? (await deps.accountingService.getTotalReceived(payment.id))

  payment.receivedAmount = {
    value: received || BigInt(0),
    assetCode: payment.asset.code,
    assetScale: payment.asset.scale
  }

  return payment
}
