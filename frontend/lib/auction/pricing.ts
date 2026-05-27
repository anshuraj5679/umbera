import type { DecryptedOrder } from "./types";

export const PRICE_SCALE = 10n ** 9n;

export function priceQuotePerBaseScaled(o: DecryptedOrder): bigint {
  if (o.side === "BUY") {
    return (o.remainingDeposit * 10n ** BigInt(o.assetDecimals) * PRICE_SCALE) / (o.remainingRequest * 10n ** BigInt(o.cashDecimals));
  } else {
    return (o.remainingRequest * 10n ** BigInt(o.assetDecimals) * PRICE_SCALE) / (o.remainingDeposit * 10n ** BigInt(o.cashDecimals));
  }
}

export function unscalePrice(scaled: bigint): bigint {
  return scaled / PRICE_SCALE;
}
