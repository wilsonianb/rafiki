import assert from 'assert'
import { IocContract } from '@adonisjs/fold'
import * as Pay from '@interledger/pay'

import { AppServices } from '../app'
import { AssetOptions } from '../asset/service'
import { isIncomingPaymentError } from '../open_payments/payment/incoming/errors'
import { Quote } from '../open_payments/quote/model'
import { CreateQuoteOptions } from '../open_payments/quote/service'

export async function createQuote(
  deps: IocContract<AppServices>,
  {
    accountId,
    receivingAccount,
    receivingPayment,
    sendAmount,
    receiveAmount
  }: CreateQuoteOptions
): Promise<Quote> {
  assert.ok(!receivingAccount !== !receivingPayment)
  const accountService = await deps.use('accountService')
  const account = await accountService.get(accountId)
  assert.ok(account)
  assert.ok(
    !sendAmount ||
      (account.asset.code === sendAmount.assetCode &&
        account.asset.scale === sendAmount.assetScale)
  )
  const assetService = await deps.use('assetService')
  const asset = await assetService.get({
    code: account.asset.code,
    scale: account.asset.scale
  })
  assert.ok(asset)

  const config = await deps.use('config')
  const incomingPaymentService = await deps.use('incomingPaymentService')
  let receiveAsset: AssetOptions | undefined
  if (receivingAccount) {
    assert.ok(!sendAmount !== !receiveAmount)
    const accountUrlPrefix = `${config.publicHost}/`
    assert.ok(receivingAccount.startsWith(accountUrlPrefix))
    const receivingAccountId = receivingAccount.slice(accountUrlPrefix.length)
    const account = await accountService.get(receivingAccountId)
    assert.ok(account)
    if (receiveAmount) {
      assert.ok(
        account.asset.code === receiveAmount.assetCode &&
          account.asset.scale === receiveAmount.assetScale
      )
    } else {
      assert.ok(sendAmount)
      receiveAsset = {
        code: account.asset.code,
        scale: account.asset.scale
      }
    }

    const incomingPayment = await incomingPaymentService.create({
      accountId: receivingAccountId,
      incomingAmount: receiveAmount
    })
    assert.ok(!isIncomingPaymentError(incomingPayment))
    receivingPayment = `${receivingAccount}/incoming-payments/${incomingPayment.id}`
  } else {
    assert.ok(receivingPayment)
    assert.ok(receivingPayment.startsWith(config.publicHost))
    const path = receivingPayment.slice(config.publicHost.length + 1).split('/')
    assert.ok(path.length === 3)
    const incomingPayment = await incomingPaymentService.get(path[2])
    assert.ok(incomingPayment)
    assert.ok(incomingPayment.incomingAmount || receiveAmount || sendAmount)
    if (receiveAmount) {
      assert.ok(
        incomingPayment.asset.code === receiveAmount.assetCode &&
          incomingPayment.asset.scale === receiveAmount.assetScale
      )
      assert.ok(
        !incomingPayment.incomingAmount ||
          receiveAmount.value <= incomingPayment.incomingAmount.value
      )
    } else {
      receiveAsset = {
        code: incomingPayment.asset.code,
        scale: incomingPayment.asset.scale
      }
      if (!sendAmount) {
        receiveAmount = incomingPayment.incomingAmount
      }
    }
  }

  if (sendAmount) {
    assert.ok(receiveAsset)
    receiveAmount = {
      value: BigInt(
        Math.ceil(Number(sendAmount.value) / (2 * (1 + config.slippage)))
      ),
      assetCode: receiveAsset.code,
      assetScale: receiveAsset.scale
    }
  } else {
    assert.ok(receiveAmount)
    sendAmount = {
      value: BigInt(
        Math.ceil(Number(receiveAmount.value) * 2 * (1 + config.slippage))
      ),
      assetCode: account.asset.code,
      assetScale: account.asset.scale
    }
  }

  return await Quote.query()
    .insertAndFetch({
      accountId,
      assetId: asset.id,
      receivingPayment,
      sendAmount,
      receiveAmount,
      maxPacketAmount: BigInt('9223372036854775807'),
      lowEstimatedExchangeRate: Pay.Ratio.of(
        Pay.Int.from(500000000000n) as Pay.PositiveInt,
        Pay.Int.from(1000000000000n) as Pay.PositiveInt
      ),
      highEstimatedExchangeRate: Pay.Ratio.of(
        Pay.Int.from(500000000001n) as Pay.PositiveInt,
        Pay.Int.from(1000000000000n) as Pay.PositiveInt
      ),
      minExchangeRate: Pay.Ratio.of(
        Pay.Int.from(495n) as Pay.PositiveInt,
        Pay.Int.from(1000n) as Pay.PositiveInt
      ),
      expiresAt: new Date(Date.now() + config.quoteLifespan)
    })
    .withGraphFetched('asset')
}
