import type { AuctionMatch, AuctionResult, DecryptedOrder } from "./types";
import { PRICE_SCALE, priceQuotePerBaseScaled, unscalePrice } from "./pricing";

export function runAuction(orders: DecryptedOrder[]): AuctionResult {
  const liveOrders = orders.filter((o) => o.remainingDeposit > 0n && o.remainingRequest > 0n);
  const buys  = liveOrders.filter(o => o.side === "BUY").map(o => ({ o, p: priceQuotePerBaseScaled(o) })).sort((a, b) => (b.p > a.p ? 1 : -1));
  const sells = liveOrders.filter(o => o.side === "SELL").map(o => ({ o, p: priceQuotePerBaseScaled(o) })).sort((a, b) => (a.p > b.p ? 1 : -1));

  if (buys.length === 0 || sells.length === 0) return { clearingPriceQuotePerBase: 0n, clearingPriceQuotePerBaseScaled: 0n, matches: [] };
  if (buys[0]!.p < sells[0]!.p) return { clearingPriceQuotePerBase: 0n, clearingPriceQuotePerBaseScaled: 0n, matches: [] };

  let i = 0, j = 0;
  let marginBuyP = 0n, marginSellP = 0n;
  while (i < buys.length && j < sells.length && buys[i]!.p >= sells[j]!.p) {
    marginBuyP = buys[i]!.p;
    marginSellP = sells[j]!.p;
    i++; j++;
  }
  const clearingScaled = (marginBuyP + marginSellP) / 2n;
  const clearingPrice  = unscalePrice(clearingScaled);

  const matches: AuctionMatch[] = [];
  let bi = 0, si = 0;
  let buyRemAsset = buys[0]?.o.remainingRequest ?? 0n;
  let buyRemCash = buys[0]?.o.remainingDeposit ?? 0n;
  let sellRemAsset = sells[0]?.o.remainingDeposit ?? 0n;
  while (bi < i && si < j) {
    const buy = buys[bi]!, sell = sells[si]!;
    let assetAmount = buyRemAsset < sellRemAsset ? buyRemAsset : sellRemAsset;
    let cashAmount = (assetAmount * clearingScaled * 10n ** BigInt(buy.o.cashDecimals)) / (PRICE_SCALE * 10n ** BigInt(buy.o.assetDecimals));
    if (cashAmount > buyRemCash) {
      cashAmount = buyRemCash;
      assetAmount = (cashAmount * PRICE_SCALE * 10n ** BigInt(buy.o.assetDecimals)) / (clearingScaled * 10n ** BigInt(buy.o.cashDecimals));
    }
    matches.push({ buyOrderId: buy.o.id, sellOrderId: sell.o.id, assetAmount, cashAmount });
    buyRemAsset -= assetAmount;
    buyRemCash -= cashAmount;
    sellRemAsset -= assetAmount;
    if (buyRemAsset === 0n || buyRemCash === 0n) { bi++; buyRemAsset = buys[bi]?.o.remainingRequest ?? 0n; buyRemCash = buys[bi]?.o.remainingDeposit ?? 0n; }
    if (sellRemAsset === 0n) { si++; sellRemAsset = sells[si]?.o.remainingDeposit ?? 0n; }
  }
  return { clearingPriceQuotePerBase: clearingPrice, clearingPriceQuotePerBaseScaled: clearingScaled, matches };
}
