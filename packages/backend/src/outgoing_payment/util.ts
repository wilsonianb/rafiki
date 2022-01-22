import * as Pay from '@interledger/pay'
import assert from 'assert'

export function toDestinationAmount(
  sourceAmount: bigint,
  minExchangeRate: Pay.Ratio
): bigint {
  if (!sourceAmount) {
    return BigInt(0)
  }
  assert.ok(minExchangeRate.isPositive())
  const srcAmount = Pay.Int.from(sourceAmount)
  assert.ok(srcAmount.isPositive())
  const destinationAmount = srcAmount
    .saturatingSubtract(Pay.Int.ONE)
    .multiplyCeil(minExchangeRate)
  return destinationAmount.value
}

export function toSourceAmount(
  destinationAmount: bigint,
  minExchangeRate: Pay.Ratio
): bigint {
  if (!destinationAmount) {
    return BigInt(0)
  }
  assert.ok(minExchangeRate.isPositive())
  const destAmount = Pay.Int.from(destinationAmount)
  assert.ok(destAmount.isPositive())
  const sourceAmount = destAmount
    .multiplyFloor(minExchangeRate.reciprocal())
    .add(Pay.Int.ONE)
  return sourceAmount.value
}
