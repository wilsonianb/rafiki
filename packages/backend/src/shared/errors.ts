import { TransferError } from '../transfer/errors'

export class BalanceTransferError extends Error {
  constructor(public error: TransferError) {
    super()
    this.name = 'TransferError'
  }
}

export class UnknownAssetError extends Error {
  constructor(assetId: string) {
    super('Asset not found. assetId=' + assetId)
    this.name = 'UnknownAssetError'
  }
}

export class UnknownBalanceError extends Error {
  constructor(accountId: string) {
    super('Balance not found. accountId=' + accountId)
    this.name = 'UnknownBalanceError'
  }
}

export class UnknownLiquidityAccountError extends Error {
  constructor(assetId: string) {
    super('Unknown liquidity account. assetId=' + assetId)
    this.name = 'UnknownLiquidityAccountError'
  }
}

export class UnknownSettlementAccountError extends Error {
  constructor(assetId: string) {
    super('Unknown settlement account. assetId=' + assetId)
    this.name = 'UnknownSettlementAccountError'
  }
}
