import { BalanceError } from '../balance/errors'

export class CreateAssetBalanceError extends Error {
  constructor(public error: BalanceError) {
    super()
    this.name = 'CreateAssetBalanceError'
  }
}
