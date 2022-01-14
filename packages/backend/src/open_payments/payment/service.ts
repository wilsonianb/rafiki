import { ForeignKeyViolationError, TransactionOrKnex } from 'objection'
import * as Pay from '@interledger/pay'
import { v4 as uuid } from 'uuid'

import { BaseService } from '../../shared/baseService'
import { Payment, PaymentIntent, PaymentState } from './model'
import { AccountingService } from '../../accounting/service'
import { AccountService } from '../account/service'
import { RatesService } from '../../rates/service'
import { WebhookService } from '../../webhook/service'
import { IlpPlugin, IlpPluginOptions } from './ilp_plugin'
import * as worker from './worker'

export interface PaymentService {
  get(id: string): Promise<Payment | undefined>
  create(options: CreatePaymentOptions): Promise<Payment>
  processNext(): Promise<string | undefined>
  getAccountPage(accountId: string, pagination?: Pagination): Promise<Payment[]>
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
  ratesService: RatesService
  webhookService: WebhookService
  makeIlpPlugin: (options: IlpPluginOptions) => IlpPlugin
}

export async function createPaymentService(
  deps_: ServiceDependencies
): Promise<PaymentService> {
  const deps = {
    ...deps_,
    logger: deps_.logger.child({ service: 'PaymentService' })
  }
  return {
    get: (id) => getPayment(deps, id),
    create: (options: CreatePaymentOptions) => createPayment(deps, options),
    processNext: () => worker.processPendingPayment(deps),
    getAccountPage: (accountId, pagination) =>
      getAccountPage(deps, accountId, pagination)
  }
}

async function getPayment(
  deps: ServiceDependencies,
  id: string
): Promise<Payment | undefined> {
  return Payment.query(deps.knex).findById(id).withGraphJoined('account.asset')
}

type CreatePaymentOptions = PaymentIntent & {
  accountId: string
}

// TODO ensure this is idempotent/safe for fixed send payments
async function createPayment(
  deps: ServiceDependencies,
  options: CreatePaymentOptions
): Promise<Payment> {
  try {
    return await Payment.transaction(deps.knex, async (trx) => {
      const payment = await Payment.query(trx)
        .insertAndFetch({
          state: PaymentState.Quoting,
          intent: {
            paymentPointer: options.paymentPointer,
            invoiceUrl: options.invoiceUrl,
            amountToSend: options.amountToSend
          },
          accountId: options.accountId,
          destinationAccount: PLACEHOLDER_DESTINATION
        })
        .withGraphFetched('account.asset')

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
 * @returns Payment[] An array of payments that form a page.
 */
async function getAccountPage(
  deps: ServiceDependencies,
  accountId: string,
  pagination?: Pagination
): Promise<Payment[]> {
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
    return Payment.query(deps.knex)
      .where({ accountId })
      .andWhereRaw(
        '("createdAt", "id") > (select "createdAt" :: TIMESTAMP, "id" from "payments" where "id" = ?)',
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
    return Payment.query(deps.knex)
      .where({ accountId })
      .andWhereRaw(
        '("createdAt", "id") < (select "createdAt" :: TIMESTAMP, "id" from "payments" where "id" = ?)',
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

  return Payment.query(deps.knex)
    .where({ accountId })
    .orderBy([
      { column: 'createdAt', order: 'asc' },
      { column: 'id', order: 'asc' }
    ])
    .limit(first)
}
