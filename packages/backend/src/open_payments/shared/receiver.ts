import { IncomingPaymentJSON } from '../payment/incoming/model'

export function isValidReceiver(incomingPayment: IncomingPaymentJSON): boolean {
  if (incomingPayment.completed) {
    return false
  }
  if (
    incomingPayment.expiresAt &&
    new Date(incomingPayment.expiresAt).getTime() <= Date.now()
  ) {
    return false
  }
  if (incomingPayment.incomingAmount) {
    if (
      BigInt(incomingPayment.incomingAmount.value) <=
      BigInt(incomingPayment.receivedAmount.value)
    ) {
      return false
    }
  }
  return true
}
