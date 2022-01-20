import assert from 'assert'
import { ForeignKeyViolationError, TransactionOrKnex } from 'objection'
import * as Pay from '@interledger/pay'
import { v4 as uuid } from 'uuid'

import { BaseService } from '../shared/baseService'
import { CreateError } from './errors'
import { OutgoingPayment, PaymentIntent, PaymentState } from './model'
import { AccountingService } from '../accounting/service'
import { AccountService } from '../open_payments/account/service'
import { RatesService } from '../rates/service'
import { WebhookService } from '../webhook/service'
import { IlpPlugin, IlpPluginOptions } from './ilp_plugin'
import * as worker from './worker'

export interface OutgoingPaymentService {
  get(id: string): Promise<OutgoingPayment | undefined>
  create(
    options: CreateOutgoingPaymentOptions
  ): Promise<OutgoingPayment | CreateError>
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

export type CreateOutgoingPaymentOptions = PaymentIntent & {
  accountId: string
}

// TODO ensure this is idempotent/safe for fixed send payments
async function createOutgoingPayment(
  deps: ServiceDependencies,
  options: CreateOutgoingPaymentOptions
): Promise<OutgoingPayment | CreateError> {
  if (options.assetCode) {
    const prices = await deps.ratesService.prices()
    if (!prices[options.assetCode]) {
      return CreateError.UnknownAsset
    }
  }

  try {
    return await OutgoingPayment.transaction(deps.knex, async (trx) => {
      const payment = await OutgoingPayment.query(trx)
        .insertAndFetch({
          state: PaymentState.Quoting,
          intent: {
            invoiceUrl: options.invoiceUrl,
            maxSourceAmount: options.maxSourceAmount,
            paymentPointer: options.paymentPointer,
            amountToSend: options.amountToSend,
            amountToDeliver: options.amountToDeliver,
            amount: options.amount,
            assetCode: options.assetCode,
            assetScale: options.assetScale
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

      if (options.amount) {
        if (options.assetCode === payment.account.asset.code) {
          const amountToSend = await deps.ratesService.convert({
            sourceAmount: options.amount,
            sourceAsset: {
              code: options.assetCode,
              scale: options.assetScale
            },
            destinationAsset: payment.account.asset
          })
          assert(typeof amountToSend === 'bigint')
          await payment.$query(trx).patch({
            intent: {
              paymentPointer: options.paymentPointer,
              amountToSend
            }
          })
        } else if (options.assetCode === destination.destinationAsset.code) {
          const amountToDeliver = await deps.ratesService.convert({
            sourceAmount: options.amount,
            sourceAsset: {
              code: options.assetCode,
              scale: options.assetScale
            },
            destinationAsset: destination.destinationAsset
          })
          assert(typeof amountToDeliver === 'bigint')
          await payment.$query(trx).patch({
            intent: {
              paymentPointer: options.paymentPointer,
              amountToDeliver,
              maxSourceAmount: options.maxSourceAmount
            }
          })
        }
      }

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
      return CreateError.UnknownAccount
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
