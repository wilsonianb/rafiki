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
import { OpenPaymentsClientService } from '../client/service'
import { PaymentPointer } from '../payment_pointer/model'
import { PaymentPointerService } from '../payment_pointer/service'
import { IncomingPaymentJSON } from '../payment/incoming/model'
import { isValidReceiver } from '../shared/receiver'
import { toResolvedPayment } from '../shared/resolvedPayment'
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
  clientService: OpenPaymentsClientService
  paymentPointerService: PaymentPointerService
  ratesService: RatesService
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

  try {
    const incomingPayment = await resolveDestination(deps, options)
    const ilpQuote = await startQuote(deps, {
      ...options,
      paymentPointer,
      incomingPayment
    })

    return await Quote.transaction(deps.knex, async (trx) => {
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
            assetCode: incomingPayment.receivedAmount.assetCode,
            assetScale: incomingPayment.receivedAmount.assetScale
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
        const receivingPaymentValue = incomingPayment?.incomingAmount
          ? BigInt(incomingPayment.incomingAmount.value) -
            BigInt(incomingPayment.receivedAmount.value)
          : undefined
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
  }
}

export async function resolveDestination(
  deps: ServiceDependencies,
  options: CreateQuoteOptions
): Promise<IncomingPaymentJSON> {
  let incomingPayment: IncomingPaymentJSON
  try {
    incomingPayment = await deps.clientService.incomingPayment.get(
      options.receiver
    )
  } catch (err) {
    if (err === Pay.PaymentError.QueryFailed) {
      throw QuoteError.InvalidDestination
    }
    throw err
  }
  if (!incomingPayment || !isValidReceiver(incomingPayment)) {
    throw QuoteError.InvalidDestination
  }
  if (options.receiveAmount) {
    if (
      options.receiveAmount.assetScale !==
        incomingPayment.receivedAmount.assetScale ||
      options.receiveAmount.assetCode !==
        incomingPayment.receivedAmount.assetCode
    ) {
      throw QuoteError.InvalidAmount
    }
    if (incomingPayment.incomingAmount) {
      const receivingPaymentValue =
        BigInt(incomingPayment.incomingAmount.value) -
        BigInt(incomingPayment.receivedAmount.value)
      if (receivingPaymentValue < options.receiveAmount.value) {
        throw QuoteError.InvalidAmount
      }
    }
  } else if (!options.sendAmount && !incomingPayment.incomingAmount) {
    throw QuoteError.InvalidDestination
  }
  return incomingPayment
}

export interface StartQuoteOptions {
  paymentPointer: PaymentPointer
  sendAmount?: Amount
  receiveAmount?: Amount
  incomingPayment: IncomingPaymentJSON
}

export async function startQuote(
  deps: ServiceDependencies,
  options: StartQuoteOptions
): Promise<Pay.Quote> {
  const prices = await deps.ratesService.prices().catch((_err: Error) => {
    throw new Error('missing prices')
  })

  const plugin = deps.makeIlpPlugin({
    sourceAccount: options.paymentPointer,
    unfulfillable: true
  })

  try {
    await plugin.connect()
    const quoteOptions: Pay.QuoteOptions = {
      plugin,
      destination: toResolvedPayment(options.incomingPayment),
      sourceAsset: {
        scale: options.paymentPointer.asset.scale,
        code: options.paymentPointer.asset.code
      }
    }
    if (options.sendAmount) {
      quoteOptions.amountToSend = options.sendAmount.value
    } else {
      quoteOptions.amountToDeliver =
        options.receiveAmount?.value ||
        BigInt(options.incomingPayment.incomingAmount.value)
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
  } finally {
    plugin.disconnect().catch((err: Error) => {
      deps.logger.warn({ error: err.message }, 'error disconnecting plugin')
    })
  }
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
