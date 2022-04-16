import assert from 'assert'
import axios from 'axios'
import { createHmac } from 'crypto'
import { Transaction } from 'knex'
import { ModelObject, TransactionOrKnex } from 'objection'
import * as Pay from '@interledger/pay'

import { BaseService } from '../../shared/baseService'
import { QuoteError, isQuoteError } from './errors'
import { Quote } from './model'
import { Amount } from '../payment/amount'
import { Account } from '../account/model'
import { AccountService } from '../account/service'
import { RatesService } from '../../rates/service'
import { IlpPlugin, IlpPluginOptions } from '../shared/ilp_plugin'

const MAX_INT64 = BigInt('9223372036854775807')

export interface QuoteService {
  get(id: string): Promise<Quote | undefined>
  create(
    options: CreateQuoteOptions,
    trx?: Transaction
  ): Promise<Quote | QuoteError>
}

export interface ServiceDependencies extends BaseService {
  knex: TransactionOrKnex
  slippage: number
  quoteUrl: string
  quoteLifespan: number // milliseconds
  signatureSecret?: string
  signatureVersion: number
  accountService: AccountService
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
    create: (options: CreateQuoteOptions, trx?: Transaction) =>
      createQuote(deps, options, trx)
  }
}

async function getQuote(
  deps: ServiceDependencies,
  id: string
): Promise<Quote | undefined> {
  return Quote.query(deps.knex).findById(id).withGraphJoined('asset')
}

export interface CreateQuoteOptions {
  accountId: string
  sendAmount?: Amount
  receiveAmount?: Amount
  receivingAccount?: string
  receivingPayment?: string
}

async function createQuote(
  deps: ServiceDependencies,
  options: CreateQuoteOptions,
  trx?: Transaction
): Promise<Quote | QuoteError> {
  if (options.receivingPayment) {
    if (options.receivingAccount) {
      return QuoteError.InvalidDestination
    }
    if (options.sendAmount && options.receiveAmount) {
      return QuoteError.InvalidAmount
    }
  } else if (options.receivingAccount) {
    if (options.sendAmount) {
      if (options.receiveAmount || options.sendAmount.value <= BigInt(0)) {
        return QuoteError.InvalidAmount
      }
    } else if (
      !options.receiveAmount ||
      options.receiveAmount.value <= BigInt(0)
    ) {
      return QuoteError.InvalidAmount
    }
  } else {
    return QuoteError.InvalidDestination
  }

  const account = await deps.accountService.get(options.accountId)
  if (!account) {
    return QuoteError.UnknownAccount
  }
  if (options.sendAmount) {
    if (
      options.sendAmount.assetCode !== account.asset.code ||
      options.sendAmount.assetScale !== account.asset.scale
    ) {
      return QuoteError.InvalidAmount
    }
  }

  const quoteTrx = trx || (await Quote.startTransaction(deps.knex))
  try {
    const ilpQuote = await startQuote(
      {
        ...deps,
        knex: quoteTrx
      },
      options,
      account
    )
    const quote = await finalizeQuote(
      {
        ...deps,
        knex: quoteTrx
      },
      ilpQuote,
      options.sendAmount
        ? Pay.PaymentType.FixedSend
        : Pay.PaymentType.FixedDelivery
    )
    if (!trx) {
      await quoteTrx.commit()
    }
    return quote
  } catch (err) {
    if (!trx) {
      await quoteTrx.rollback()
    }
    if (isQuoteError(err)) {
      return err
    }
    throw err
  }
}

export async function startQuote(
  deps: ServiceDependencies,
  options: CreateQuoteOptions,
  account: Account
): Promise<Quote> {
  const plugin = deps.makeIlpPlugin({
    sourceAccount: account,
    unfulfillable: true
  })
  try {
    await plugin.connect()

    const setupOptions: Pay.SetupOptions = { plugin }
    if (options.receivingPayment) {
      setupOptions.destinationPayment = options.receivingPayment
    } else {
      setupOptions.destinationAccount = options.receivingAccount
      if (options.receiveAmount) {
        setupOptions.amountToDeliver = {
          value: options.receiveAmount.value,
          assetCode: options.receiveAmount.assetCode,
          assetScale: options.receiveAmount.assetScale
        }
      }
    }
    const destination = await Pay.setupPayment(setupOptions)
    if (!destination.destinationPaymentDetails) {
      deps.logger.warn(
        {
          options
        },
        'missing incoming payment'
      )
      throw new Error('missing incoming payment')
    }

    // validateAssets(deps, options, destination)

    const prices = await deps.ratesService.prices().catch((_err: Error) => {
      throw new Error('missing prices')
    })
    const quoteOptions: Pay.QuoteOptions = {
      plugin,
      destination,
      sourceAsset: {
        scale: account.asset.scale,
        code: account.asset.code
      },
      slippage: deps.slippage,
      prices
    }
    assert.ok(quoteOptions.destination.destinationPaymentDetails)
    if (options.sendAmount) {
      quoteOptions.amountToSend = options.sendAmount.value
      quoteOptions.destination.destinationPaymentDetails.incomingAmount = undefined
    } else if (options.receiveAmount) {
      if (options.receivingPayment) {
        quoteOptions.amountToDeliver = options.receiveAmount.value
        if (destination.destinationPaymentDetails.incomingAmount) {
          const remainingToReceive =
            destination.destinationPaymentDetails.incomingAmount.value -
            destination.destinationPaymentDetails.receivedAmount.value
          if (remainingToReceive < options.receiveAmount.value) {
            throw QuoteError.InvalidAmount
          }
          quoteOptions.destination.destinationPaymentDetails.incomingAmount = undefined
        }
      } else {
        assert.ok(
          destination.destinationPaymentDetails.incomingAmount?.value ===
            options.receiveAmount.value
        )
      }
    } else {
      if (!destination.destinationPaymentDetails.incomingAmount) {
        throw QuoteError.InvalidDestination
      }
    }
    const quote = await Pay.startQuote(quoteOptions).finally(() => {
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

    // TODO: check fixed-send's quote.minDeliveryAmount does not exceed receivingPayment's incomingAmount
    // Should that be here or after wallet sets receiveAmount?

    // Pay.startQuote should return PaymentError.InvalidSourceAmount or
    // PaymentError.InvalidDestinationAmount for non-positive amounts.
    // Outgoing payments' sendAmount or receiveAmount should never be
    // zero or negative.
    assert.ok(quote.maxSourceAmount > BigInt(0))
    assert.ok(quote.minDeliveryAmount > BigInt(0))

    return await Quote.query(deps.knex)
      .insertAndFetch({
        accountId: options.accountId,
        assetId: account.assetId,
        receivingPayment: destination.destinationPaymentDetails.id,
        sendAmount: {
          value: quote.maxSourceAmount,
          assetCode: account.asset.code,
          assetScale: account.asset.scale
        },
        receiveAmount: {
          value: quote.minDeliveryAmount,
          assetCode: destination.destinationAsset.code,
          assetScale: destination.destinationAsset.scale
        },
        ...quote,
        // Cap at MAX_INT64 because of postgres type limits.
        maxPacketAmount:
          MAX_INT64 < quote.maxPacketAmount ? MAX_INT64 : quote.maxPacketAmount,
        // Patch using createdAt below
        expiresAt: new Date()
      })
      .withGraphFetched('asset')
  } finally {
    plugin.disconnect().catch((err: Error) => {
      deps.logger.warn({ error: err.message }, 'error disconnecting plugin')
    })
  }
}

export async function finalizeQuote(
  deps: ServiceDependencies,
  quote: Quote,
  paymentType: Pay.PaymentType
): Promise<Quote> {
  const requestHeaders = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }

  const body = {
    ...quote.toJSON(),
    paymentType
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
  if (paymentType === Pay.PaymentType.FixedSend) {
    if (
      sendAmount.value !== quote.sendAmount.value ||
      receiveAmount.value > quote.receiveAmount.value
    ) {
      throw QuoteError.InvalidAmount
    }
  } else {
    if (
      receiveAmount.value !== quote.receiveAmount.value ||
      sendAmount.value > quote.sendAmount.value
    ) {
      throw QuoteError.InvalidAmount
    }
  }

  await quote.$query(deps.knex).patch({
    sendAmount,
    receiveAmount,
    expiresAt: new Date(quote.createdAt.getTime() + deps.quoteLifespan)
  })
  new Date(Date.now() + deps.quoteLifespan)
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
