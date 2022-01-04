import { ForeignKeyViolationError, TransactionOrKnex } from 'objection'
import * as Pay from '@interledger/pay'
import { v4 as uuid } from 'uuid'

import { BaseService } from '../shared/baseService'
import { LifecycleError, OutgoingPaymentError } from './errors'
import {
  InvoiceIntent,
  OutgoingPayment,
  PaymentIntent,
  PaymentState
} from './model'
import { AccountingService } from '../accounting/service'
import { AccountService } from '../open_payments/account/service'
import { MandateService } from '../open_payments/mandate/service'
import { RatesService } from '../rates/service'
import { WebhookService } from '../webhook/service'
import { IlpPlugin, IlpPluginOptions } from './ilp_plugin'
import * as lifecycle from './lifecycle'
import * as worker from './worker'

export interface OutgoingPaymentService {
  get(id: string): Promise<OutgoingPayment | undefined>
  create(options: CreateOutgoingPaymentOptions): Promise<OutgoingPayment>
  fund(
    options: FundOutgoingPaymentOptions
  ): Promise<OutgoingPayment | OutgoingPaymentError>
  cancel(id: string): Promise<OutgoingPayment | OutgoingPaymentError>
  cancelMandatePayments(
    mandateId: string,
    trx: TransactionOrKnex
  ): Promise<void>
  requote(id: string): Promise<OutgoingPayment | OutgoingPaymentError>
  processNext(): Promise<string | undefined>
  getAccountPage(
    accountId: string,
    pagination?: Pagination
  ): Promise<OutgoingPayment[]>
}

const PLACEHOLDER_DESTINATION = {
  code: 'TMP',
  scale: 2
}

export interface ServiceDependencies extends BaseService {
  knex: TransactionOrKnex
  slippage: number
  quoteLifespan: number // milliseconds
  accountingService: AccountingService
  accountService: AccountService
  mandateService: MandateService
  ratesService: RatesService
  webhookService: WebhookService
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
    fund: (options) => fundPayment(deps, options),
    cancel: (id) => cancelPayment(deps, id),
    cancelMandatePayments: (mandateId, trx) =>
      cancelMandatePayments(deps, mandateId, trx),
    requote: (id) => requotePayment(deps, id),
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
    .withGraphJoined('[account.asset, mandate]')
}

type ChargeOptions = InvoiceIntent & {
  mandateId: string
  accountId?: never
}

type CreateOutgoingPaymentOptions =
  | ChargeOptions
  | (PaymentIntent & {
      accountId: string
      mandateId?: never
    })

// TODO ensure this is idempotent/safe for fixed send payments
async function createOutgoingPayment(
  deps: ServiceDependencies,
  options: CreateOutgoingPaymentOptions
): Promise<OutgoingPayment> {
  let accountId: string
  if (options.mandateId) {
    const mandate = await deps.mandateService.get(options.mandateId)
    if (!mandate) {
      throw new Error('outgoing payment mandate does not exist')
    }
    if (mandate.revoked) {
      throw new Error('outgoing payment mandate is revoked')
    }
    if (mandate.expiresAt && mandate.expiresAt <= new Date()) {
      throw new Error('outgoing payment mandate is expired')
    }
    if (mandate.startAt && mandate.startAt > new Date()) {
      throw new Error('outgoing payment mandate is not active')
    }
    if (mandate.balance === BigInt(0)) {
      throw new Error('outgoing payment mandate has zero balance')
    }
    accountId = mandate.accountId
  } else if (options.accountId) {
    accountId = options.accountId
  }
  try {
    return await OutgoingPayment.transaction(deps.knex, async (trx) => {
      const payment = await OutgoingPayment.query(trx)
        .insertAndFetch({
          state: PaymentState.Quoting,
          intent: {
            paymentPointer: options.paymentPointer,
            invoiceUrl: options.invoiceUrl,
            amountToSend: options.amountToSend
          },
          accountId,
          mandateId: options.mandateId,
          destinationAccount: PLACEHOLDER_DESTINATION
        })
        .withGraphFetched('[account.asset, mandate]')

      const plugin = deps.makeIlpPlugin({
        sourceAccount: {
          id: uuid(),
          asset: payment.account.asset
        },
        unfulfillable: true
      })
      await plugin.connect()
      const destination = await Pay.setupPayment({
        plugin,
        paymentPointer: options.paymentPointer,
        invoiceUrl: options.invoiceUrl
      }).finally(() => {
        plugin.disconnect().catch((err) => {
          deps.logger.warn({ error: err.message }, 'error disconnecting plugin')
        })
      })

      await payment.$query(trx).patch({
        destinationAccount: {
          scale: destination.destinationAsset.scale,
          code: destination.destinationAsset.code,
          url: destination.accountUrl
        }
      })

      await deps.accountingService.createAccount({
        id: payment.id,
        asset: payment.account.asset
      })

      return payment
    })
  } catch (err) {
    if (err instanceof ForeignKeyViolationError) {
      throw new Error('outgoing payment account does not exist')
    }
    throw err
  }
}

function requotePayment(
  deps: ServiceDependencies,
  id: string
): Promise<OutgoingPayment | OutgoingPaymentError> {
  return deps.knex.transaction(async (trx) => {
    const payment = await OutgoingPayment.query(trx).findById(id).forUpdate()
    if (!payment) return OutgoingPaymentError.UnknownPayment
    if (payment.state !== PaymentState.Cancelled) {
      return OutgoingPaymentError.WrongState
    }
    await payment.$query(trx).patch({ state: PaymentState.Quoting })
    return payment
  })
}

export interface FundOutgoingPaymentOptions {
  id: string
  amount: bigint
  transferId: string
}

async function fundPayment(
  deps: ServiceDependencies,
  { id, amount, transferId }: FundOutgoingPaymentOptions
): Promise<OutgoingPayment | OutgoingPaymentError> {
  return deps.knex.transaction(async (trx) => {
    const payment = await OutgoingPayment.query(trx)
      .findById(id)
      .forUpdate()
      .withGraphFetched('account.asset')
    if (!payment) return OutgoingPaymentError.UnknownPayment
    if (payment.state !== PaymentState.Funding) {
      return OutgoingPaymentError.WrongState
    }
    if (!payment.quote) throw LifecycleError.MissingQuote
    const error = await deps.accountingService.createDeposit({
      id: transferId,
      accountId: payment.id,
      amount
    })
    if (error) {
      throw new Error('Unable to fund payment. error=' + error)
    }
    const balance = await deps.accountingService.getBalance(payment.id)
    if (balance === undefined) {
      throw LifecycleError.MissingBalance
    }
    if (payment.quote.maxSourceAmount <= balance) {
      await payment.$query(trx).patch({ state: PaymentState.Sending })
    }
    return payment
  })
}

async function cancelPayment(
  deps: ServiceDependencies,
  id: string
): Promise<OutgoingPayment | OutgoingPaymentError> {
  return deps.knex.transaction(async (trx) => {
    const payment = await OutgoingPayment.query(trx).findById(id).forUpdate()
    if (!payment) return OutgoingPaymentError.UnknownPayment
    if (payment.state !== PaymentState.Funding) {
      return OutgoingPaymentError.WrongState
    }
    await lifecycle.handleCancelled(
      {
        ...deps,
        knex: trx
      },
      payment,
      LifecycleError.CancelledByAPI
    )
    return payment
  })
}

async function cancelMandatePayments(
  deps: ServiceDependencies,
  mandateId: string,
  trx: TransactionOrKnex
): Promise<void> {
  const payments = await OutgoingPayment.query(trx)
    .where({ mandateId })
    .forUpdate()
  for (const payment of payments) {
    await lifecycle.handleCancelled(
      {
        ...deps,
        knex: trx
      },
      payment,
      LifecycleError.CancelledByMandate
    )
  }
}

interface Pagination {
  after?: string // Forward pagination: cursor.
  before?: string // Backward pagination: cursor.
  first?: number // Forward pagination: limit.
  last?: number // Backward pagination: limit.
}

/**
 * The pagination algorithm is based on the Relay connection specification.
 * Please read the spec before changing things:
 * https://relay.dev/graphql/connections.htm
 * @param deps ServiceDependencies.
 * @param accountId The accountId of the payments' sending user.
 * @param pagination Pagination - cursors and limits.
 * @returns OutgoingPayment[] An array of payments that form a page.
 */
async function getAccountPage(
  deps: ServiceDependencies,
  accountId: string,
  pagination?: Pagination
): Promise<OutgoingPayment[]> {
  if (
    typeof pagination?.before === 'undefined' &&
    typeof pagination?.last === 'number'
  ) {
    throw new Error("Can't paginate backwards from the start.")
  }

  const first = pagination?.first || 20
  if (first < 0 || first > 100) throw new Error('Pagination index error')
  const last = pagination?.last || 20
  if (last < 0 || last > 100) throw new Error('Pagination index error')

  /**
   * Forward pagination
   */
  if (typeof pagination?.after === 'string') {
    return OutgoingPayment.query(deps.knex)
      .where({ accountId })
      .andWhereRaw(
        '("createdAt", "id") > (select "createdAt" :: TIMESTAMP, "id" from "outgoingPayments" where "id" = ?)',
        [pagination.after]
      )
      .orderBy([
        { column: 'createdAt', order: 'asc' },
        { column: 'id', order: 'asc' }
      ])
      .limit(first)
  }

  /**
   * Backward pagination
   */
  if (typeof pagination?.before === 'string') {
    return OutgoingPayment.query(deps.knex)
      .where({ accountId })
      .andWhereRaw(
        '("createdAt", "id") < (select "createdAt" :: TIMESTAMP, "id" from "outgoingPayments" where "id" = ?)',
        [pagination.before]
      )
      .orderBy([
        { column: 'createdAt', order: 'desc' },
        { column: 'id', order: 'desc' }
      ])
      .limit(last)
      .then((resp) => {
        return resp.reverse()
      })
  }

  return OutgoingPayment.query(deps.knex)
    .where({ accountId })
    .orderBy([
      { column: 'createdAt', order: 'asc' },
      { column: 'id', order: 'asc' }
    ])
    .limit(first)
}
