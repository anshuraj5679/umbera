export function computeDepositAmount(assetAmount: bigint, priceCashPerAsset: bigint, assetDecimals: number): bigint {
  return (assetAmount * priceCashPerAsset) / (10n ** BigInt(assetDecimals));
}

export function scaleByDecimals(value: number, decimals: number): bigint {
  return BigInt(Math.round(value * 10 ** decimals));
}
