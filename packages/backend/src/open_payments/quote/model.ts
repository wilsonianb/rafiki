import assert from 'assert'
import { Model, Pojo } from 'objection'
import * as Pay from '@interledger/pay'

import { Amount, AmountJSON } from '../payment/amount'
import { Account } from '../account/model'
import { Asset } from '../../asset/model'
import { BaseModel } from '../../shared/baseModel'

export class Quote extends BaseModel {
  public static readonly tableName = 'quotes'

  static get virtualAttributes(): string[] {
    return [
      'sendAmount',
      'receiveAmount',
      // 'maxSourceAmount',
      // 'minDeliveryAmount',
      'minExchangeRate',
      'lowEstimatedExchangeRate',
      'highEstimatedExchangeRate'
    ]
  }

  // Open payments account id of the sender
  public accountId!: string
  public account?: Account

  // Asset id of the sender
  public assetId!: string
  public asset!: Asset

  static relationMappings = {
    account: {
      relation: Model.HasOneRelation,
      modelClass: Account,
      join: {
        from: 'quotes.accountId',
        to: 'accounts.id'
      }
    },
    asset: {
      relation: Model.HasOneRelation,
      modelClass: Asset,
      join: {
        from: 'quotes.assetId',
        to: 'assets.id'
      }
    }
  }

  public expiresAt?: Date | null

  public receivingPayment!: string

  private sendAmountValue!: bigint

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
  private lowExchangeRateEstimateNumerator!: bigint
  private lowExchangeRateEstimateDenominator!: bigint
  private highExchangeRateEstimateNumerator!: bigint
  private highExchangeRateEstimateDenominator!: bigint

  public get paymentType(): Pay.PaymentType {
    return Pay.PaymentType.FixedDelivery
  }

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
      Pay.Int.from(this.lowExchangeRateEstimateNumerator) as Pay.PositiveInt,
      Pay.Int.from(this.lowExchangeRateEstimateDenominator) as Pay.PositiveInt
    )
  }

  public set lowEstimatedExchangeRate(value: Pay.Ratio) {
    this.lowExchangeRateEstimateNumerator = value.a.value
    this.lowExchangeRateEstimateDenominator = value.b.value
  }

  // Note that the upper exchange rate bound is *exclusive*.
  public get highEstimatedExchangeRate(): Pay.PositiveRatio {
    const highEstimatedExchangeRate = Pay.Ratio.of(
      Pay.Int.from(this.highExchangeRateEstimateNumerator) as Pay.PositiveInt,
      Pay.Int.from(this.highExchangeRateEstimateDenominator) as Pay.PositiveInt
    )
    assert.ok(highEstimatedExchangeRate.isPositive())
    return highEstimatedExchangeRate
  }

  public set highEstimatedExchangeRate(value: Pay.PositiveRatio) {
    this.highExchangeRateEstimateNumerator = value.a.value
    this.highExchangeRateEstimateDenominator = value.b.value
  }

  $formatJson(json: Pojo): Pojo {
    json = super.$formatJson(json)
    const data: Pojo = {
      id: json.id,
      accountId: json.accountId,
      // createdAt: new Date(+json.createdAt).toISOString(),
      receivingPayment: json.receivingPayment,
      sendAmount: {
        ...json.sendAmount,
        value: json.sendAmount.value.toString()
      },
      receiveAmount: {
        ...json.receiveAmount,
        value: json.receiveAmount.value.toString()
      },
      paymentType: json.paymentType
    }
    // if (json.expiresAt) {
    //   data.expiresAt = json.expiresAt.toISOString()
    // }
    return data
  }
}

export type QuoteJSON = {
  id: string
  accountId: string
  createdAt: string
  receivingPayment: string
  sendAmount: AmountJSON
  receiveAmount: AmountJSON
  expiresAt?: string
}
