import * as Pay from '@interledger/pay'

import { LifecycleError } from './errors'
import {
  OutgoingPayment,
  OutgoingPaymentState,
  PaymentEvent,
  PaymentEventType
} from './model'
import { ServiceDependencies } from './service'
import { IlpPlugin } from '../../../shared/ilp_plugin'

// "payment" is locked by the "deps.knex" transaction.
export async function handleSending(
  deps: ServiceDependencies,
  payment: OutgoingPayment,
  plugin: IlpPlugin
): Promise<void> {
  if (!payment.quote) throw LifecycleError.MissingQuote

  const destination = await Pay.setupPayment({
    plugin,
    destinationPayment: payment.receivingPayment
  })

  if (!destination.destinationPaymentDetails) {
    throw LifecycleError.MissingIncomingPayment
  }

  validateAssets(deps, payment, destination)

  // TODO: Query Tigerbeetle transfers by code to distinguish sending debits from withdrawals
  const amountSent = await deps.accountingService.getTotalSent(payment.id)
  if (amountSent === undefined) {
    throw LifecycleError.MissingBalance
  }

  // Due to SENDING→SENDING retries, the quote's amount parameters may need adjusting.
  const newMaxSourceAmount = payment.sendAmount.value - amountSent

  let newMinDeliveryAmount
  if (destination.destinationPaymentDetails.incomingAmount) {
    newMinDeliveryAmount =
      destination.destinationPaymentDetails.incomingAmount.value -
      destination.destinationPaymentDetails.receivedAmount.value
  } else {
    // This is only an approximation of the true amount delivered due to exchange rate variance. The true amount delivered is returned on stream response packets, but due to connection failures there isn't a reliable way to track that in sync with the amount sent.
    // eslint-disable-next-line no-case-declarations
    const amountDelivered = BigInt(
      Math.ceil(
        +amountSent.toString() * payment.quote.minExchangeRate.valueOf()
      )
    )
    newMinDeliveryAmount = payment.receiveAmount.value - amountDelivered
  }

  if (
    (payment.quote.paymentType === Pay.PaymentType.FixedSend &&
      newMaxSourceAmount <= BigInt(0)) ||
    (payment.quote.paymentType === Pay.PaymentType.FixedDelivery &&
      newMinDeliveryAmount <= BigInt(0))
  ) {
    // Payment is already (unexpectedly) done. Maybe this is a retry and the previous attempt failed to save the state to Postgres. Or the invoice could have been paid by a totally different payment in the time since the quote.
    deps.logger.warn(
      {
        newMaxSourceAmount,
        newMinDeliveryAmount,
        paymentType: payment.quote.paymentType,
        amountSent,
        incomingPayment: destination.destinationPaymentDetails
      },
      'handleSending payment was already paid'
    )
    await handleCompleted(deps, payment)
    return
  } else if (
    newMaxSourceAmount <= BigInt(0) ||
    newMinDeliveryAmount <= BigInt(0)
  ) {
    // Similar to the above, but not recoverable (at least not without a re-quote).
    // I'm not sure whether this case is actually reachable, but handling it here is clearer than passing ilp-pay bad parameters.
    deps.logger.error(
      {
        newMaxSourceAmount,
        newMinDeliveryAmount,
        paymentType: payment.quote.paymentType
      },
      'handleSending bad retry state'
    )
    throw LifecycleError.BadState
  }

  const lowEstimatedExchangeRate = payment.quote.lowEstimatedExchangeRate
  const highEstimatedExchangeRate = payment.quote.highEstimatedExchangeRate
  const minExchangeRate = payment.quote.minExchangeRate
  const quote: Pay.Quote = {
    ...payment.quote,
    paymentType: payment.quote.paymentType,
    // Adjust quoted amounts to account for prior partial payment.
    maxSourceAmount: newMaxSourceAmount,
    minDeliveryAmount: newMinDeliveryAmount,
    lowEstimatedExchangeRate,
    highEstimatedExchangeRate,
    minExchangeRate
  }

  const receipt = await Pay.pay({ plugin, destination, quote }).finally(() => {
    return Pay.closeConnection(plugin, destination).catch((err) => {
      // Ignore connection close failures, all of the money was delivered.
      deps.logger.warn(
        {
          destination: destination.destinationAddress,
          error: err.message
        },
        'close pay connection failed'
      )
    })
  })

  deps.logger.debug(
    {
      destination: destination.destinationAddress,
      error: receipt.error,
      paymentType: payment.quote.paymentType,
      newMaxSourceAmount,
      newMinDeliveryAmount,
      receiptAmountSent: receipt.amountSent,
      receiptAmountDelivered: receipt.amountDelivered
    },
    'payed'
  )

  if (receipt.error) throw receipt.error

  await handleCompleted(deps, payment)
}

export async function handleFailed(
  deps: ServiceDependencies,
  payment: OutgoingPayment,
  error: string
): Promise<void> {
  await payment.$query(deps.knex).patch({
    state: OutgoingPaymentState.Failed,
    error
  })
  await sendWebhookEvent(deps, payment, PaymentEventType.PaymentFailed)
}

const handleCompleted = async (
  deps: ServiceDependencies,
  payment: OutgoingPayment
): Promise<void> => {
  await payment.$query(deps.knex).patch({
    state: OutgoingPaymentState.Completed
  })
  await sendWebhookEvent(deps, payment, PaymentEventType.PaymentCompleted)
}

export const sendWebhookEvent = async (
  deps: ServiceDependencies,
  payment: OutgoingPayment,
  type: PaymentEventType
): Promise<void> => {
  const amountSent = await deps.accountingService.getTotalSent(payment.id)
  const balance = await deps.accountingService.getBalance(payment.id)
  if (amountSent === undefined || balance === undefined) {
    throw LifecycleError.MissingBalance
  }

  const withdrawal = balance
    ? {
        accountId: payment.id,
        assetId: payment.assetId,
        amount: balance
      }
    : undefined
  await PaymentEvent.query(deps.knex).insertAndFetch({
    type,
    data: payment.toData({ amountSent, balance }),
    withdrawal
  })
}

const validateAssets = (
  deps: ServiceDependencies,
  payment: OutgoingPayment,
  destination: Pay.ResolvedPayment
): void => {
  if (payment.assetId !== payment.account?.assetId) {
    throw LifecycleError.SourceAssetConflict
  }
  if (payment.receiveAmount) {
    if (
      payment.receiveAmount.assetScale !== destination.destinationAsset.scale ||
      payment.receiveAmount.assetCode !== destination.destinationAsset.code
    ) {
      deps.logger.warn(
        {
          oldAsset: payment.receiveAmount,
          newAsset: destination.destinationAsset
        },
        'destination asset changed'
      )
      throw Pay.PaymentError.DestinationAssetConflict
    }
  }
}
