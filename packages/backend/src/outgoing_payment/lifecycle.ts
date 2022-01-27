import * as Pay from '@interledger/pay'

import { LifecycleError } from './errors'
import { OutgoingPayment, PaymentState } from './model'
import { ServiceDependencies } from './service'
import { IlpPlugin } from './ilp_plugin'
import { DepositType, WithdrawalType } from '../liquidity/service'

const MAX_INT64 = BigInt('9223372036854775807')

// Acquire a quote for the user to approve.
// "payment" is locked by the "deps.knex" transaction.
export async function handleQuoting(
  deps: ServiceDependencies,
  payment: OutgoingPayment,
  plugin: IlpPlugin
): Promise<void> {
  const prices = await deps.ratesService.prices().catch((_err: Error) => {
    throw LifecycleError.PricesUnavailable
  })

  const destination = await Pay.setupPayment({
    plugin,
    paymentPointer: payment.intent.paymentPointer,
    invoiceUrl: payment.intent.invoiceUrl
  })

  if (
    payment.destinationAccount.scale !== destination.destinationAsset.scale ||
    payment.destinationAccount.code !== destination.destinationAsset.code
  ) {
    deps.logger.warn(
      {
        oldAsset: payment.destinationAccount,
        newAsset: destination.destinationAsset
      },
      'asset changed'
    )
    throw Pay.PaymentError.DestinationAssetConflict
  }

  // TODO: Query Tigerbeetle transfers by code to distinguish sending debits from withdrawals
  const amountSent = await deps.accountingService.getTotalSent(payment.id)
  if (amountSent === undefined) {
    throw LifecycleError.MissingBalance
  }

  // This is the amount of money *remaining* to send, which may be less than the payment intent's amountToSend due to retries (FixedSend payments only).
  let amountToSend: bigint | undefined
  if (payment.intent.amountToSend) {
    amountToSend = payment.intent.amountToSend - amountSent
    if (amountToSend <= BigInt(0)) {
      // The FixedSend payment completed (in Tigerbeetle) but the backend's update to state=COMPLETED didn't commit. Then the payment retried and ended up here.
      // This error is extremely unlikely to happen, but it can recover gracefully(ish) by shortcutting to the COMPLETED state.
      deps.logger.error(
        {
          amountToSend,
          intentAmountToSend: payment.intent.amountToSend,
          amountSent
        },
        'quote amountToSend bounds error'
      )
      await payment.$query(deps.knex).patch({
        state: PaymentState.Completed
      })
      return
    }
  }

  const quote = await Pay.startQuote({
    plugin,
    destination,
    sourceAsset: {
      scale: payment.account.asset.scale,
      code: payment.account.asset.code
    },
    amountToSend,
    slippage: deps.slippage,
    prices
  })
    .finally(() => {
      return Pay.closeConnection(plugin, destination).catch((err) => {
        deps.logger.warn(
          {
            destination: destination.destinationAddress,
            error: err.message
          },
          'close quote connection failed'
        )
      })
    })
    .catch(async (err) => {
      if (err === Pay.PaymentError.InvoiceAlreadyPaid) return null
      throw err
    })
  // InvoiceAlreadyPaid: the invoice was already paid, either by this payment (which retried due to a failed SENDING→COMPLETED transition commit) or another payment entirely.
  if (quote === null) {
    deps.logger.warn('quote invoice already paid')
    await payment.$query(deps.knex).patch({
      state: PaymentState.Completed
    })
    return
  }

  const balance = await deps.accountingService.getBalance(payment.id)
  if (balance === undefined) {
    throw LifecycleError.MissingBalance
  }

  const state =
    balance < quote.maxSourceAmount
      ? PaymentState.Funding
      : PaymentState.Sending

  await payment.$query(deps.knex).patch({
    state,
    quote: {
      timestamp: new Date(),
      activationDeadline: new Date(Date.now() + deps.quoteLifespan),
      targetType: quote.paymentType,
      minDeliveryAmount: quote.minDeliveryAmount,
      maxSourceAmount: quote.maxSourceAmount,
      // Cap at MAX_INT64 because of postgres type limits.
      maxPacketAmount:
        MAX_INT64 < quote.maxPacketAmount ? MAX_INT64 : quote.maxPacketAmount,
      minExchangeRate: quote.minExchangeRate,
      lowExchangeRateEstimate: quote.lowEstimatedExchangeRate,
      highExchangeRateEstimate: quote.highEstimatedExchangeRate,
      amountSent
    }
  })
}

// "payment" is locked by the "deps.knex" transaction.
export async function handleFunding(
  deps: ServiceDependencies,
  payment: OutgoingPayment
): Promise<void> {
  if (!payment.quote) throw LifecycleError.MissingQuote
  const now = new Date()
  if (payment.quote.activationDeadline < now) {
    throw LifecycleError.QuoteExpired
  }

  if (!payment.withdrawalId) throw LifecycleError.MissingWebhook

  const amountSent = await deps.accountingService.getTotalSent(payment.id)
  const balance = await deps.accountingService.getBalance(payment.id)
  if (amountSent === undefined || balance === undefined) {
    throw LifecycleError.MissingBalance
  }

  payment.amountSent = amountSent
  payment.balance = balance
  try {
    await deps.liquidityService.deposit({
      id: payment.withdrawalId,
      type: DepositType.PaymentFunding,
      payment,
      amount: payment.quote.maxSourceAmount
    })
    await payment.$query(deps.knex).patch({ state: PaymentState.Sending })
  } catch (err) {
    if (err.isAxiosError && err.response.status === 403) {
      await payment.$query(deps.knex).patch({
        state: PaymentState.Cancelled,
        error: LifecycleError.CancelledByWebhook
      })
    } else {
      throw err
    }
  }
}

// "payment" is locked by the "deps.knex" transaction.
export async function handleSending(
  deps: ServiceDependencies,
  payment: OutgoingPayment,
  plugin: IlpPlugin
): Promise<void> {
  if (!payment.quote) throw LifecycleError.MissingQuote

  const destination = await Pay.setupPayment({
    plugin,
    paymentPointer: payment.intent.paymentPointer,
    invoiceUrl: payment.intent.invoiceUrl
  })

  if (
    payment.destinationAccount.scale !== destination.destinationAsset.scale ||
    payment.destinationAccount.code !== destination.destinationAsset.code
  ) {
    deps.logger.warn(
      {
        oldAsset: payment.destinationAccount,
        newAsset: destination.destinationAsset
      },
      'asset changed'
    )
    throw Pay.PaymentError.DestinationAssetConflict
  }

  // TODO: Query Tigerbeetle transfers by code to distinguish sending debits from withdrawals
  const amountSent = await deps.accountingService.getTotalSent(payment.id)
  if (amountSent === undefined) {
    throw LifecycleError.MissingBalance
  }

  // Due to SENDING→SENDING retries, the quote's amount parameters may need adjusting.
  const amountSentSinceQuote = amountSent - payment.quote.amountSent
  const newMaxSourceAmount =
    payment.quote.maxSourceAmount - amountSentSinceQuote

  let newMinDeliveryAmount
  switch (payment.quote.targetType) {
    case Pay.PaymentType.FixedSend:
      // This is only an approximation of the true amount delivered due to exchange rate variance. The true amount delivered is returned on stream response packets, but due to connection failures there isn't a reliable way to track that in sync with the amount sent.
      // eslint-disable-next-line no-case-declarations
      const amountDeliveredSinceQuote = BigInt(
        Math.ceil(
          +amountSentSinceQuote.toString() *
            payment.quote.minExchangeRate.valueOf()
        )
      )
      newMinDeliveryAmount =
        payment.quote.minDeliveryAmount - amountDeliveredSinceQuote
      break
    case Pay.PaymentType.FixedDelivery:
      if (!destination.invoice) throw LifecycleError.MissingInvoice
      newMinDeliveryAmount =
        destination.invoice.amountToDeliver -
        destination.invoice.amountDelivered
      break
  }

  if (
    (payment.quote.targetType === Pay.PaymentType.FixedSend &&
      newMaxSourceAmount <= BigInt(0)) ||
    (payment.quote.targetType === Pay.PaymentType.FixedDelivery &&
      newMinDeliveryAmount <= BigInt(0))
  ) {
    // Payment is already (unexpectedly) done. Maybe this is a retry and the previous attempt failed to save the state to Postgres. Or the invoice could have been paid by a totally different payment in the time since the quote.
    deps.logger.warn(
      {
        newMaxSourceAmount,
        newMinDeliveryAmount,
        paymentType: payment.quote.targetType,
        amountSentSinceQuote,
        invoice: destination.invoice
      },
      'handleSending payment was already paid'
    )
    await payment.$query(deps.knex).patch({
      state: PaymentState.Completed
    })
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
        paymentType: payment.quote.targetType
      },
      'handleSending bad retry state'
    )
    throw LifecycleError.BadState
  }

  const lowEstimatedExchangeRate = payment.quote.lowExchangeRateEstimate
  const highEstimatedExchangeRate = payment.quote.highExchangeRateEstimate
  const minExchangeRate = payment.quote.minExchangeRate
  if (!highEstimatedExchangeRate.isPositive()) {
    // This shouldn't ever happen, since the rate is correct when they are stored during the quoting stage.
    deps.logger.error(
      {
        lowEstimatedExchangeRate,
        highEstimatedExchangeRate,
        minExchangeRate
      },
      'invalid estimated rate'
    )
    throw LifecycleError.InvalidRatio
  }
  const quote = {
    paymentType: payment.quote.targetType,
    // Adjust quoted amounts to account for prior partial payment.
    maxSourceAmount: newMaxSourceAmount,
    minDeliveryAmount: newMinDeliveryAmount,
    maxPacketAmount: payment.quote.maxPacketAmount,
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
      paymentType: payment.quote.targetType,
      newMaxSourceAmount,
      newMinDeliveryAmount,
      receiptAmountSent: receipt.amountSent,
      receiptAmountDelivered: receipt.amountDelivered
    },
    'payed'
  )

  if (receipt.error) throw receipt.error

  await payment.$query(deps.knex).patch({
    state: PaymentState.Completed
  })
}

export async function handleCancelledOrCompleted(
  deps: ServiceDependencies,
  payment: OutgoingPayment
): Promise<void> {
  if (!payment.withdrawalId) throw LifecycleError.MissingWebhook

  const amountSent = await deps.accountingService.getTotalSent(payment.id)
  const balance = await deps.accountingService.getBalance(payment.id)
  if (amountSent === undefined || balance === undefined) {
    throw LifecycleError.MissingBalance
  }

  if (balance === BigInt(0)) {
    await payment.$query(deps.knex).patch({
      withdrawalId: null
    })
    return
  }

  payment.amountSent = amountSent
  payment.balance = balance
  const { status } = await deps.liquidityService.withdraw({
    id: payment.withdrawalId,
    type:
      payment.state === PaymentState.Cancelled
        ? WithdrawalType.PaymentCancelled
        : WithdrawalType.PaymentCompleted,
    payment,
    amount: balance
  })
  if (status === 200) {
    await payment.$query(deps.knex).patch({
      withdrawalId: null
    })
  } else if (status === 205 && payment.state === PaymentState.Cancelled) {
    await payment.$query(deps.knex).patch({
      state: PaymentState.Quoting
    })
  }
}
