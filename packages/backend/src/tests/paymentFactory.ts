import { IocContract } from '@adonisjs/fold'
import * as Pay from '@interledger/pay'
import assert from 'assert'
import axios from 'axios'

import { randomAsset } from './asset'
import { AppServices } from '../app'
import { isCreateError } from '../outgoing_payment/errors'
import { OutgoingPayment } from '../outgoing_payment/model'
import { CreateOutgoingPaymentOptions } from '../outgoing_payment/service'

export class PaymentFactory {
  public constructor(private deps: IocContract<AppServices>) {}

  public async build(
    options: Partial<CreateOutgoingPaymentOptions> = {}
  ): Promise<OutgoingPayment> {
    const accountService = await this.deps.use('accountService')
    const account = options.accountId
      ? await accountService.get(options.accountId)
      : await accountService.create({
          asset: randomAsset()
        })
    assert(account)

    let paymentOptions: CreateOutgoingPaymentOptions

    if (options.invoiceUrl) {
      if (!options.maxSourceAmount) {
        const resp = await axios.get(options.invoiceUrl)
        // This doesn't account for slippage used in payment quote
        // Update rate service to allow slippage in conversion?
        const config = await this.deps.use('config')
        const ratesService = await this.deps.use('ratesService')
        const maxSourceAmount = await ratesService.convert({
          sourceAmount: BigInt(resp.data.amount),
          sourceAsset: {
            code: resp.data.assetCode,
            scale: resp.data.assetScale
          },
          destinationAsset: account.asset,
          slippage: config.slippage
        })
        assert(typeof maxSourceAmount === 'bigint')
        // https://github.com/interledgerjs/interledgerjs/blob/7f175879fe456fc3b40312be1369278e0d197a79/packages/pay/src/index.ts#L381
        options.maxSourceAmount = maxSourceAmount + 1n
      }
      paymentOptions = {
        accountId: account.id,
        invoiceUrl: options.invoiceUrl,
        maxSourceAmount: options.maxSourceAmount
      }
    } else {
      paymentOptions = {
        accountId: account.id,
        paymentPointer:
          options.paymentPointer || 'http://wallet2.example/paymentpointer/bob',
        amountToSend: options.amountToSend || BigInt(123)
      }
    }

    const streamServer = await this.deps.use('streamServer')
    const {
      ilpAddress: destinationAddress,
      sharedSecret
    } = streamServer.generateCredentials()
    jest.spyOn(Pay, 'setupPayment').mockResolvedValueOnce({
      destinationAsset: {
        scale: 9,
        code: 'XRP'
      },
      accountUrl: 'http://wallet2.example/paymentpointer/bob',
      destinationAddress,
      sharedSecret,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      requestCounter: Pay.Counter.from(0)!
    })

    const outgoingPaymentService = await this.deps.use('outgoingPaymentService')
    const payment = await outgoingPaymentService.create(paymentOptions)
    assert.ok(!isCreateError(payment))

    return payment
  }
}
