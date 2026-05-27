/**
 * Computes cash/payment token amount for an asset-sized order.
 *
 * Current deployment convention:
 * - pair.base  = cash/payment token, e.g. eUSDC
 * - pair.quote = traded asset token, e.g. eWETH/eWBTC
 *
 * `assetAmount` is scaled by asset decimals.
 * `priceCashPerAsset` is scaled by cash decimals.
 */
export function computeCashAmount(assetAmount: bigint, priceCashPerAsset: bigint, assetDecimals: number) {
  return (assetAmount * priceCashPerAsset) / (10n ** BigInt(assetDecimals));
}
