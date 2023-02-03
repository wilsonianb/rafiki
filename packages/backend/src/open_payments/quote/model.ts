import { Model, Pojo } from 'objection'
import * as Pay from '@interledger/pay'

import { Amount, serializeAmount } from '../amount'
import {
  PaymentPointer,
  PaymentPointerSubresource
} from '../payment_pointer/model'
import { Asset } from '../../asset/model'
import { Quote as OpenPaymentsQuote } from 'open-payments'

export class Quote extends PaymentPointerSubresource<OpenPaymentsQuote> {
  public static readonly tableName = 'quotes'
  public static readonly urlPath = '/quotes'

  static get virtualAttributes(): string[] {
    return [
      'sendAmount',
      'receiveAmount',
      'minExchangeRate',
      'lowEstimatedExchangeRate',
      'highEstimatedExchangeRate'
    ]
  }

  // Asset id of the sender
  public assetId!: string
  public asset!: Asset

  static get relationMappings() {
    return {
      ...super.relationMappings,
      asset: {
        relation: Model.HasOneRelation,
        modelClass: Asset,
        join: {
          from: 'quotes.assetId',
          to: 'assets.id'
        }
      }
    }
  }

  public expiresAt!: Date

  public receiver!: string

  private sendAmountValue!: bigint

  public getUrl(paymentPointer: PaymentPointer): string {
    return `${paymentPointer.url}${Quote.urlPath}/${this.id}`
  }

  public get sendAmount(): Amount {
    return {
      value: this.sendAmountValue,
      assetCode: this.asset.code,
      assetScale: this.asset.scale
    }
  }

  public set sendAmount(amount: Amount) {
    this.sendAmountValue = amount.value
  }

  private receiveAmountValue!: bigint
  private receiveAmountAssetCode!: string
  private receiveAmountAssetScale!: number

  public get receiveAmount(): Amount {
    return {
      value: this.receiveAmountValue,
      assetCode: this.receiveAmountAssetCode,
      assetScale: this.receiveAmountAssetScale
    }
  }

  public set receiveAmount(amount: Amount) {
    this.receiveAmountValue = amount.value
    this.receiveAmountAssetCode = amount.assetCode
    this.receiveAmountAssetScale = amount?.assetScale
  }

  public maxPacketAmount!: bigint
  private minExchangeRateNumerator!: bigint
  private minExchangeRateDenominator!: bigint
  private lowEstimatedExchangeRateNumerator!: bigint
  private lowEstimatedExchangeRateDenominator!: bigint
  private highEstimatedExchangeRateNumerator!: bigint
  private highEstimatedExchangeRateDenominator!: bigint

  public get maxSourceAmount(): bigint {
    return this.sendAmountValue
  }

  public get minDeliveryAmount(): bigint {
    return this.receiveAmountValue
  }

  public get minExchangeRate(): Pay.Ratio {
    return Pay.Ratio.of(
      Pay.Int.from(this.minExchangeRateNumerator) as Pay.PositiveInt,
      Pay.Int.from(this.minExchangeRateDenominator) as Pay.PositiveInt
    )
  }

  public set minExchangeRate(value: Pay.Ratio) {
    this.minExchangeRateNumerator = value.a.value
    this.minExchangeRateDenominator = value.b.value
  }

  public get lowEstimatedExchangeRate(): Pay.Ratio {
    return Pay.Ratio.of(
      Pay.Int.from(this.lowEstimatedExchangeRateNumerator) as Pay.PositiveInt,
      Pay.Int.from(this.lowEstimatedExchangeRateDenominator) as Pay.PositiveInt
    )
  }

  public set lowEstimatedExchangeRate(value: Pay.Ratio) {
    this.lowEstimatedExchangeRateNumerator = value.a.value
    this.lowEstimatedExchangeRateDenominator = value.b.value
  }

  // Note that the upper exchange rate bound is *exclusive*.
  public get highEstimatedExchangeRate(): Pay.PositiveRatio {
    const highEstimatedExchangeRate = Pay.Ratio.of(
      Pay.Int.from(this.highEstimatedExchangeRateNumerator) as Pay.PositiveInt,
      Pay.Int.from(this.highEstimatedExchangeRateDenominator) as Pay.PositiveInt
    )
    if (!highEstimatedExchangeRate.isPositive()) {
      throw new Error()
    }
    return highEstimatedExchangeRate
  }

  public set highEstimatedExchangeRate(value: Pay.PositiveRatio) {
    this.highEstimatedExchangeRateNumerator = value.a.value
    this.highEstimatedExchangeRateDenominator = value.b.value
  }

  $formatJson(json: Pojo): Pojo {
    json = super.$formatJson(json)
    return {
      id: json.id,
      paymentPointerId: json.paymentPointerId,
      receiver: json.receiver,
      sendAmount: {
        ...json.sendAmount,
        value: json.sendAmount.value.toString()
      },
      receiveAmount: {
        ...json.receiveAmount,
        value: json.receiveAmount.value.toString()
      },
      createdAt: json.createdAt,
      expiresAt: json.expiresAt.toISOString()
    }
  }

  public toOpenPaymentsType({
    paymentPointer
  }: {
    paymentPointer: PaymentPointer
  }): OpenPaymentsQuote {
    return {
      id: this.getUrl(paymentPointer),
      paymentPointer: paymentPointer.url,
      receiveAmount: serializeAmount(this.receiveAmount),
      sendAmount: serializeAmount(this.sendAmount),
      receiver: this.receiver,
      expiresAt: this.expiresAt.toISOString(),
      createdAt: this.createdAt.toISOString()
    }
  }
}
