import assert from 'assert'
import axios from 'axios'
import * as Pay from '@interledger/pay'

import { Asset } from '../asset/model'
import { AssetOptions } from '../asset/service'
import { Config } from '../config/app'
import { Quote } from '../open_payments/quote/model'
import { CreateQuoteOptions } from '../open_payments/quote/service'

export async function createQuote({
  accountId,
  receivingAccount,
  receivingPayment,
  sendAmount,
  receiveAmount
}: CreateQuoteOptions): Promise<Quote> {
  assert.ok(!receivingAccount !== !receivingPayment)
  const account = await axios
    .get(`${Config.publicHost}/${accountId}`)
    .then((res) => res.data)
  assert.ok(account)
  assert.ok(
    !sendAmount ||
      (account.assetCode === sendAmount.assetCode &&
        account.assetScale === sendAmount.assetScale)
  )
  const asset = await Asset.query().findOne({
    code: account.assetCode,
    scale: account.assetScale
  })
  assert.ok(asset)

  let receiveAsset: AssetOptions | undefined
  if (receivingAccount) {
    assert.ok(!sendAmount !== !receiveAmount)
    const account = await axios
      .get(receivingAccount.replace('$', 'https://'))
      .then((res) => res.data)
    assert.ok(account)
    if (receiveAmount) {
      assert.ok(
        account.assetCode === receiveAmount.assetCode &&
          account.assetScale === receiveAmount.assetScale
      )
    } else {
      assert.ok(sendAmount)
      receiveAsset = {
        code: account.assetCode,
        scale: account.assetScale
      }
    }

    const incomingPayment = await axios
      .post(
        `${receivingAccount.replace('$', 'https://')}/incoming-payments`,
        {
          incomingAmount: receiveAmount && {
            ...receiveAmount,
            value: receiveAmount.value.toString()
          }
        },
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          validateStatus: (status) => status === 201
        }
      )
      .then((res) => res.data)
    receivingPayment = incomingPayment.id
  } else {
    assert.ok(receivingPayment)
    const payment = await axios.get(receivingPayment).then((res) => res.data)
    assert.ok(payment)
    assert.ok(payment.incomingAmount || receiveAmount || sendAmount)
    if (receiveAmount) {
      assert.ok(
        payment.receivedAmount.assetCode === receiveAmount.assetCode &&
          payment.receivedAmount.assetScale === receiveAmount.assetScale
      )
      assert.ok(
        !payment.incomingAmount ||
          receiveAmount.value <= BigInt(payment.incomingAmount.value)
      )
    } else {
      receiveAsset = {
        code: payment.receivedAmount.assetCode,
        scale: payment.receivedAmount.assetScale
      }
      if (!sendAmount) {
        receiveAmount = {
          ...payment.incomingAmount,
          value: BigInt(payment.incomingAmount.value)
        }
      }
    }
  }

  if (sendAmount) {
    assert.ok(receiveAsset)
    receiveAmount = {
      value: BigInt(
        Math.ceil(Number(sendAmount.value) / (2 * (1 + Config.slippage)))
      ),
      assetCode: receiveAsset.code,
      assetScale: receiveAsset.scale
    }
  } else {
    assert.ok(receiveAmount)
    sendAmount = {
      value: BigInt(
        Math.ceil(Number(receiveAmount.value) * 2 * (1 + Config.slippage))
      ),
      assetCode: account.assetCode,
      assetScale: account.assetScale
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
      expiresAt: new Date(Date.now() + Config.quoteLifespan)
    })
    .withGraphFetched('asset')
}
