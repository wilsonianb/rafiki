import { Invoice } from './model'
import { AccountingService } from '../../accounting/service'
import { BaseService } from '../../shared/baseService'
import { Pagination } from '../../shared/pagination'
import { EventType, WebhookService } from '../../webhook/service'
import assert from 'assert'
import { Transaction } from 'knex'
import { ForeignKeyViolationError, TransactionOrKnex } from 'objection'

export const POSITIVE_SLIPPAGE = BigInt(1)

interface CreateOptions {
  accountId: string
  description?: string
  expiresAt: Date
  amount: bigint
}

export interface InvoiceService {
  get(id: string): Promise<Invoice | undefined>
  create(options: CreateOptions, trx?: Transaction): Promise<Invoice>
  getAccountInvoicesPage(
    accountId: string,
    pagination?: Pagination
  ): Promise<Invoice[]>
  handlePayment(invoiceId: string): Promise<void>
  deactivateNext(): Promise<string | undefined>
}

interface ServiceDependencies extends BaseService {
  knex: TransactionOrKnex
  accountingService: AccountingService
  webhookService: WebhookService
}

export async function createInvoiceService(
  deps_: ServiceDependencies
): Promise<InvoiceService> {
  const log = deps_.logger.child({
    service: 'InvoiceService'
  })
  const deps: ServiceDependencies = {
    ...deps_,
    logger: log
  }
  return {
    get: (id) => getInvoice(deps, id),
    create: (options, trx) => createInvoice(deps, options, trx),
    getAccountInvoicesPage: (accountId, pagination) =>
      getAccountInvoicesPage(deps, accountId, pagination),
    handlePayment: (invoiceId) => handleInvoicePayment(deps, invoiceId),
    deactivateNext: () => deactivateNextInvoice(deps)
  }
}

async function getInvoice(
  deps: ServiceDependencies,
  id: string
): Promise<Invoice | undefined> {
  return Invoice.query(deps.knex).findById(id).withGraphJoined('account.asset')
}

async function createInvoice(
  deps: ServiceDependencies,
  { accountId, description, expiresAt, amount }: CreateOptions,
  trx?: Transaction
): Promise<Invoice> {
  const invTrx = trx || (await Invoice.startTransaction(deps.knex))

  try {
    const invoice = await Invoice.query(invTrx)
      .insertAndFetch({
        accountId,
        description,
        expiresAt,
        amount,
        active: true
      })
      .withGraphFetched('account.asset')

    // Invoice accounts are credited by the amounts received by the invoice.
    // Credits are restricted such that the invoice cannot receive more than that amount.
    await deps.accountingService.createAccount({
      id: invoice.id,
      asset: invoice.account.asset
    })

    if (!trx) {
      await invTrx.commit()
    }
    return invoice
  } catch (err) {
    if (!trx) {
      await invTrx.rollback()
    }
    if (err instanceof ForeignKeyViolationError) {
      throw new Error('unable to create invoice, account does not exist')
    }
    throw err
  }
}

async function handleInvoicePayment(
  deps: ServiceDependencies,
  invoiceId: string
): Promise<void> {
  const amountReceived = await deps.accountingService.getTotalReceived(
    invoiceId
  )
  if (!amountReceived) {
    return
  }
  const invoice = await Invoice.query(deps.knex)
    .patch({
      active: false
    })
    .where('id', invoiceId)
    .andWhere('amount', '<=', amountReceived.toString())
    .returning('*')
    .first()
  if (invoice) {
    await deps.webhookService.send({
      type: EventType.InvoicePaid,
      invoice,
      amountReceived
    })
  }
}

// Deactivate expired invoices that have some money.
// Delete expired invoices that have never received money.
// Returns the id of the processed invoice (if any).
async function deactivateNextInvoice(
  deps: ServiceDependencies
): Promise<string | undefined> {
  return deps.knex.transaction(async (trx) => {
    // 30 seconds backwards to allow a prepared (but not yet fulfilled/rejected) packet to finish before being deactivated.
    const now = new Date(Date.now() - 30_000).toISOString()
    const invoices = await Invoice.query(trx)
      .limit(1)
      // Ensure the invoices cannot be processed concurrently by multiple workers.
      .forUpdate()
      // If an invoice is locked, don't wait — just come back for it later.
      .skipLocked()
      .where('active', true)
      .andWhere('expiresAt', '<', now)
    const invoice = invoices[0]
    if (!invoice) return

    const amountReceived = await deps.accountingService.getTotalReceived(
      invoice.id
    )
    if (amountReceived) {
      deps.logger.trace({ invoice: invoice.id }, 'deactivating expired invoice')
      await invoice.$query(trx).patch({ active: false })
      await deps.webhookService.send({
        type: EventType.InvoiceExpired,
        invoice,
        amountReceived
      })
    } else {
      deps.logger.debug({ invoice: invoice.id }, 'deleting expired invoice')
      await invoice.$query(trx).delete()
    }
    return invoice.id
  })
}

/** TODO: Base64 encode/decode the cursors
 * Buffer.from("Hello World").toString('base64')
 * Buffer.from("SGVsbG8gV29ybGQ=", 'base64').toString('ascii')
 */

/** getAccountInvoicesPage
 * The pagination algorithm is based on the Relay connection specification.
 * Please read the spec before changing things:
 * https://relay.dev/graphql/connections.htm
 * @param deps ServiceDependencies.
 * @param accountId The accountId of the invoices.
 * @param pagination Pagination - cursors and limits.
 * @returns Invoice[] An array of invoices that form a page.
 */
async function getAccountInvoicesPage(
  deps: ServiceDependencies,
  accountId: string,
  pagination?: Pagination
): Promise<Invoice[]> {
  assert.ok(deps.knex, 'Knex undefined')

  if (
    typeof pagination?.before === 'undefined' &&
    typeof pagination?.last === 'number'
  )
    throw new Error("Can't paginate backwards from the start.")

  const first = pagination?.first || 20
  if (first < 0 || first > 100) throw new Error('Pagination index error')
  const last = pagination?.last || 20
  if (last < 0 || last > 100) throw new Error('Pagination index error')

  /**
   * Forward pagination
   */
  if (typeof pagination?.after === 'string') {
    return Invoice.query(deps.knex)
      .where({
        accountId: accountId
      })
      .andWhereRaw(
        '("createdAt", "id") > (select "createdAt" :: TIMESTAMP, "id" from "invoices" where "id" = ?)',
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
    return Invoice.query(deps.knex)
      .where({
        accountId: accountId
      })
      .andWhereRaw(
        '("createdAt", "id") < (select "createdAt" :: TIMESTAMP, "id" from "invoices" where "id" = ?)',
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

  return Invoice.query(deps.knex)
    .where({
      accountId: accountId
    })
    .orderBy([
      { column: 'createdAt', order: 'asc' },
      { column: 'id', order: 'asc' }
    ])
    .limit(first)
}
