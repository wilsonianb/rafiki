import assert from 'assert'
import axios from 'axios'
import { createHmac } from 'crypto'
import { ModelObject, TransactionOrKnex } from 'objection'
import * as Pay from '@interledger/pay'

import { Pagination } from '../../shared/baseModel'
import { BaseService } from '../../shared/baseService'
import { QuoteError, isQuoteError } from './errors'
import { Quote } from './model'
import { Amount } from '../amount'
import { PaymentPointerService } from '../payment_pointer/service'
import { SetupPaymentService } from '../setup_payment/service'
import { RatesService } from '../../rates/service'
import { IlpPlugin, IlpPluginOptions } from '../../shared/ilp_plugin'

const MAX_INT64 = BigInt('9223372036854775807')

export interface QuoteService {
  get(id: string): Promise<Quote | undefined>
  create(options: CreateQuoteOptions): Promise<Quote | QuoteError>
  getPaymentPointerPage(
    paymentPointerId: string,
    pagination?: Pagination
  ): Promise<Quote[]>
}

export interface ServiceDependencies extends BaseService {
  knex: TransactionOrKnex
  slippage: number
  quoteUrl: string
  quoteLifespan: number // milliseconds
  signatureSecret?: string
  signatureVersion: number
  paymentPointerService: PaymentPointerService
  ratesService: RatesService
  setupPaymentService: SetupPaymentService
  makeIlpPlugin: (options: IlpPluginOptions) => IlpPlugin
}

export async function createQuoteService(
  deps_: ServiceDependencies
): Promise<QuoteService> {
  const deps = {
    ...deps_,
    logger: deps_.logger.child({ service: 'QuoteService' })
  }
  return {
    get: (id) => getQuote(deps, id),
    create: (options: CreateQuoteOptions) => createQuote(deps, options),
    getPaymentPointerPage: (paymentPointerId, pagination) =>
      getPaymentPointerPage(deps, paymentPointerId, pagination)
  }
}

async function getQuote(
  deps: ServiceDependencies,
  id: string
): Promise<Quote | undefined> {
  return Quote.query(deps.knex).findById(id).withGraphJoined('asset')
}

export interface CreateQuoteOptions {
  paymentPointerId: string
  sendAmount?: Amount
  receiveAmount?: Amount
  receiver: string
}

async function createQuote(
  deps: ServiceDependencies,
  options: CreateQuoteOptions
): Promise<Quote | QuoteError> {
  if (options.sendAmount && options.receiveAmount) {
    return QuoteError.InvalidAmount
  }
  const paymentPointer = await deps.paymentPointerService.get(
    options.paymentPointerId
  )
  if (!paymentPointer) {
    return QuoteError.UnknownPaymentPointer
  }
  if (options.sendAmount) {
    if (
      options.sendAmount.value <= BigInt(0) ||
      options.sendAmount.assetCode !== paymentPointer.asset.code ||
      options.sendAmount.assetScale !== paymentPointer.asset.scale
    ) {
      return QuoteError.InvalidAmount
    }
  } else if (options.receiveAmount) {
    if (options.receiveAmount.value <= BigInt(0)) {
      return QuoteError.InvalidAmount
    }
  }

  const plugin = deps.makeIlpPlugin({
    sourceAccount: paymentPointer,
    unfulfillable: true
  })

  try {
    await plugin.connect()

    const destination = await resolveDestination(deps, options, plugin)

    const receivingPaymentValue = destination.destinationPaymentDetails
      ?.incomingAmount
      ? destination.destinationPaymentDetails.incomingAmount.value -
        destination.destinationPaymentDetails.receivedAmount.value
      : undefined

    const ilpQuote = await startQuote(deps, options, {
      plugin,
      destination,
      sourceAsset: {
        scale: paymentPointer.asset.scale,
        code: paymentPointer.asset.code
      }
    })

    return await Quote.transaction(deps.knex, async (trx) => {
      assert.ok(destination.destinationPaymentDetails)
      const quote = await Quote.query(trx)
        .insertAndFetch({
          paymentPointerId: options.paymentPointerId,
          assetId: paymentPointer.assetId,
          receiver: options.receiver,
          sendAmount: {
            value: ilpQuote.maxSourceAmount,
            assetCode: paymentPointer.asset.code,
            assetScale: paymentPointer.asset.scale
          },
          receiveAmount: {
            value: ilpQuote.minDeliveryAmount,
            assetCode: destination.destinationAsset.code,
            assetScale: destination.destinationAsset.scale
          },
          // Cap at MAX_INT64 because of postgres type limits.
          maxPacketAmount:
            MAX_INT64 < ilpQuote.maxPacketAmount
              ? MAX_INT64
              : ilpQuote.maxPacketAmount,
          minExchangeRate: ilpQuote.minExchangeRate,
          lowEstimatedExchangeRate: ilpQuote.lowEstimatedExchangeRate,
          highEstimatedExchangeRate: ilpQuote.highEstimatedExchangeRate,
          // Patch using createdAt below
          expiresAt: new Date(0)
        })
        .withGraphFetched('asset')

      let maxReceiveAmountValue: bigint | undefined
      if (options.sendAmount) {
        maxReceiveAmountValue =
          receivingPaymentValue &&
          receivingPaymentValue < quote.receiveAmount.value
            ? receivingPaymentValue
            : quote.receiveAmount.value
      }

      return await finalizeQuote(
        {
          ...deps,
          knex: trx
        },
        quote,
        maxReceiveAmountValue
      )
    })
  } catch (err) {
    if (isQuoteError(err)) {
      return err
    }
    throw err
  } finally {
    plugin.disconnect().catch((err: Error) => {
      deps.logger.warn({ error: err.message }, 'error disconnecting plugin')
    })
  }
}

export async function resolveDestination(
  deps: ServiceDependencies,
  options: CreateQuoteOptions,
  plugin: IlpPlugin
): Promise<Pay.ResolvedPayment> {
  let destination: Pay.ResolvedPayment
  try {
    destination = await deps.setupPaymentService.setupPayment(
      options.receiver,
      'TODO GNAP TOKEN',
      plugin
    )
  } catch (err) {
    if (err === Pay.PaymentError.QueryFailed) {
      throw QuoteError.InvalidDestination
    }
    throw err
  }
  if (!destination.destinationPaymentDetails) {
    deps.logger.warn(
      {
        options
      },
      'missing incoming payment'
    )
    throw new Error('missing incoming payment')
  }

  if (options.receiveAmount) {
    if (
      options.receiveAmount.assetScale !== destination.destinationAsset.scale ||
      options.receiveAmount.assetCode !== destination.destinationAsset.code
    ) {
      throw QuoteError.InvalidAmount
    }
    if (destination.destinationPaymentDetails.incomingAmount) {
      const receivingPaymentValue =
        destination.destinationPaymentDetails.incomingAmount.value -
        destination.destinationPaymentDetails.receivedAmount.value
      if (receivingPaymentValue < options.receiveAmount.value) {
        throw QuoteError.InvalidAmount
      }
    }
  } else if (
    !options.sendAmount &&
    !destination.destinationPaymentDetails.incomingAmount
  ) {
    throw QuoteError.InvalidDestination
  }
  return destination
}

export async function startQuote(
  deps: ServiceDependencies,
  options: CreateQuoteOptions,
  quoteOptions: Pay.QuoteOptions
): Promise<Pay.Quote> {
  const prices = await deps.ratesService.prices().catch((_err: Error) => {
    throw new Error('missing prices')
  })
  assert.ok(quoteOptions.destination.destinationPaymentDetails)
  if (options.sendAmount) {
    quoteOptions.amountToSend = options.sendAmount.value
    quoteOptions.destination.destinationPaymentDetails.incomingAmount =
      undefined
  } else if (options.receiveAmount) {
    quoteOptions.amountToDeliver = options.receiveAmount.value
    quoteOptions.destination.destinationPaymentDetails.incomingAmount =
      undefined
  }
  const quote = await Pay.startQuote({
    ...quoteOptions,
    slippage: deps.slippage,
    prices
  }).finally(() => {
    return Pay.closeConnection(
      quoteOptions.plugin,
      quoteOptions.destination
    ).catch((err) => {
      deps.logger.warn(
        {
          destination: quoteOptions.destination.destinationAddress,
          error: err.message
        },
        'close quote connection failed'
      )
    })
  })

  // Pay.startQuote should return PaymentError.InvalidSourceAmount or
  // PaymentError.InvalidDestinationAmount for non-positive amounts.
  // Outgoing payments' sendAmount or receiveAmount should never be
  // zero or negative.
  assert.ok(quote.maxSourceAmount > BigInt(0))
  assert.ok(quote.minDeliveryAmount > BigInt(0))

  return quote
}

export async function finalizeQuote(
  deps: ServiceDependencies,
  quote: Quote,
  maxReceiveAmountValue?: bigint
): Promise<Quote> {
  const requestHeaders = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }

  const body = {
    ...quote.toJSON(),
    paymentType: maxReceiveAmountValue
      ? Pay.PaymentType.FixedSend
      : Pay.PaymentType.FixedDelivery
  }

  if (deps.signatureSecret) {
    requestHeaders['Rafiki-Signature'] = generateQuoteSignature(
      body,
      deps.signatureSecret,
      deps.signatureVersion
    )
  }

  const res = await axios.post(deps.quoteUrl, body, {
    headers: requestHeaders,
    validateStatus: (status) => status === 201
  })

  // TODO: validate res.data is quote
  if (!res.data.sendAmount?.value || !res.data.receiveAmount?.value) {
    throw QuoteError.InvalidAmount
  }
  const sendAmount: Amount = {
    ...res.data.sendAmount,
    value: BigInt(res.data.sendAmount.value)
  }
  const receiveAmount: Amount = {
    ...res.data.receiveAmount,
    value: BigInt(res.data.receiveAmount.value)
  }
  if (maxReceiveAmountValue) {
    if (
      sendAmount.value !== quote.sendAmount.value ||
      receiveAmount.value > maxReceiveAmountValue
    ) {
      throw QuoteError.InvalidAmount
    }
  } else {
    if (
      receiveAmount.value !== quote.receiveAmount.value ||
      sendAmount.value < quote.sendAmount.value
    ) {
      throw QuoteError.InvalidAmount
    }
  }

  await quote.$query(deps.knex).patch({
    sendAmount,
    receiveAmount,
    expiresAt: new Date(quote.createdAt.getTime() + deps.quoteLifespan)
  })
  return quote
}

export function generateQuoteSignature(
  quote: ModelObject<Quote>,
  secret: string,
  version: number
): string {
  const timestamp = Math.round(new Date().getTime() / 1000)

  const payload = `${timestamp}.${quote}`
  const hmac = createHmac('sha256', secret)
  hmac.update(payload)
  const digest = hmac.digest('hex')

  return `t=${timestamp}, v${version}=${digest}`
}

async function getPaymentPointerPage(
  deps: ServiceDependencies,
  paymentPointerId: string,
  pagination?: Pagination
): Promise<Quote[]> {
  return await Quote.query(deps.knex)
    .getPage(pagination)
    .where({
      paymentPointerId
    })
    .withGraphFetched('asset')
}
