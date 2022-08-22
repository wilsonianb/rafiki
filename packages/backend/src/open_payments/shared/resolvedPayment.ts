import { Counter, ResolvedPayment } from '@interledger/pay'
import base64url from 'base64url'

import { IncomingPaymentJSON } from '../payment/incoming/model'

export function toResolvedPayment(
  incomingPayment: IncomingPaymentJSON
): ResolvedPayment {
  return {
    destinationAsset: {
      code: incomingPayment.receivedAmount.assetCode,
      scale: incomingPayment.receivedAmount.assetScale
    },
    destinationAddress: incomingPayment.ilpStreamConnection.ilpAddress,
    sharedSecret: base64url.toBuffer(
      incomingPayment.ilpStreamConnection.sharedSecret
    ),
    requestCounter: Counter.from(0)
  }
}
