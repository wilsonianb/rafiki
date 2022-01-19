export interface ConvertOptions {
  // The raw exchange rate, not including the scale difference.
  exchangeRate: number
  sourceAmount: bigint
  sourceAsset: Asset
  destinationAsset: Asset
  slippage?: number
}

export interface Asset {
  code: string
  scale: number
}

export function convert(opts: ConvertOptions): bigint {
  const maxScale = Math.max(opts.sourceAsset.scale, opts.destinationAsset.scale)
  const shiftUp = 10 ** maxScale
  const scaleDiff = opts.destinationAsset.scale - opts.sourceAsset.scale
  const scaledExchangeRate =
    opts.exchangeRate * (1 + (opts.slippage || 0)) * 10 ** scaleDiff
  return (
    (opts.sourceAmount * BigInt(scaledExchangeRate * shiftUp)) / BigInt(shiftUp)
  )
}
