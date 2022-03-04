import * as knex from 'knex'

import { ServiceDependencies } from './service'
import { OutgoingPayment, PaymentState } from './model'
import { canRetryError, PaymentError } from './errors'
import * as lifecycle from './lifecycle'
import { IlpPlugin } from './ilp_plugin'

// First retry waits 10 seconds, second retry waits 20 (more) seconds, etc.
export const RETRY_BACKOFF_SECONDS = 10

const maxStateAttempts: { [key in PaymentState]: number } = {
  PENDING: 5, // quoting
  PREPARED: Infinity, // waiting for authorization
  FUNDING: Infinity, // waiting for funds
  SENDING: 5, // send money
  COMPLETED: Infinity,
  EXPIRED: Infinity,
  FAILED: Infinity,
  REJECTED: Infinity
}

// Returns the id of the processed payment (if any).
export async function processPendingPayment(
  deps_: ServiceDependencies
): Promise<string | undefined> {
  return deps_.knex.transaction(async (trx) => {
    const payment = await getPendingPayment(trx)
    if (!payment) return

    await handlePaymentLifecycle(
      {
        ...deps_,
        knex: trx,
        logger: deps_.logger.child({
          payment: payment.id,
          from_state: payment.state
        })
      },
      payment
    )
    return payment.id
  })
}

// Fetch (and lock) a payment for work.
// Exported for testing.
export async function getPendingPayment(
  trx: knex.Transaction
): Promise<OutgoingPayment | undefined> {
  const now = new Date(Date.now()).toISOString()
  const payments = await OutgoingPayment.query(trx)
    .limit(1)
    // Ensure the payment cannot be processed concurrently by multiple workers.
    .forUpdate()
    // Don't wait for a payment that is already being processed.
    .skipLocked()
    .whereIn('state', [PaymentState.Pending, PaymentState.Sending])
    // Back off between retries.
    .andWhere((builder: knex.QueryBuilder) => {
      builder
        .where('stateAttempts', 0)
        .orWhereRaw(
          '"updatedAt" + LEAST("stateAttempts", 6) * ? * interval \'1 seconds\' < ?',
          [RETRY_BACKOFF_SECONDS, now]
        )
    })
    .orWhere((builder: knex.QueryBuilder) => {
      builder
        .where('state', PaymentState.Prepared)
        .andWhere('quoteActivationDeadline', '<', now)
    })
    .withGraphFetched('account.asset')
  return payments[0]
}

// Exported for testing.
export async function handlePaymentLifecycle(
  deps: ServiceDependencies,
  payment: OutgoingPayment
): Promise<void> {
  const onError = async (err: Error | PaymentError): Promise<void> => {
    const error = typeof err === 'string' ? err : err.message
    const stateAttempts = payment.stateAttempts + 1

    if (stateAttempts < maxStateAttempts[payment.state] && canRetryError(err)) {
      deps.logger.warn(
        { state: payment.state, error, stateAttempts },
        'payment lifecycle failed; retrying'
      )
      await payment.$query(deps.knex).patch({ stateAttempts })
    } else {
      // Too many attempts or non-retryable error; fail payment.
      deps.logger.warn(
        { state: payment.state, error, stateAttempts },
        'payment lifecycle failed'
      )
      await lifecycle.handleFailed(deps, payment, error)
    }
  }

  // Plugins are cleaned up in `finally` to avoid leaking http2 connections.
  let plugin: IlpPlugin
  switch (payment.state) {
    case PaymentState.Pending:
      plugin = deps.makeIlpPlugin({
        sourceAccount: payment,
        unfulfillable: true
      })
      return plugin
        .connect()
        .then(() => lifecycle.handlePending(deps, payment, plugin))
        .catch(onError)
        .finally(() => {
          return plugin.disconnect().catch((err: Error) => {
            deps.logger.warn(
              { error: err.message },
              'error disconnecting plugin'
            )
          })
        })
    case PaymentState.Prepared:
      return lifecycle.handlePrepared(deps, payment).catch(onError)
    case PaymentState.Sending:
      plugin = deps.makeIlpPlugin({
        sourceAccount: payment
      })
      return plugin
        .connect()
        .then(() => lifecycle.handleSending(deps, payment, plugin))
        .catch(onError)
        .finally(() => {
          return plugin.disconnect().catch((err: Error) => {
            deps.logger.warn(
              { error: err.message },
              'error disconnecting plugin'
            )
          })
        })
    default:
      deps.logger.warn('unexpected payment in lifecycle')
      break
  }
}
