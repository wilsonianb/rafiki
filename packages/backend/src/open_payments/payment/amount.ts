export interface Amount {
  value: bigint
  assetCode: string
  assetScale: number
}

export interface AmountJSON {
  value: string
  assetCode: string
  assetScale: number
}
