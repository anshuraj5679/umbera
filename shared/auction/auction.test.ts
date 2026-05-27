import { describe, it, expect } from "vitest";
import { runAuction } from "./auction.js";
import type { DecryptedOrder } from "./types.js";

describe("runAuction", () => {
  it("crosses one buy and one sell at midpoint", () => {
    const orders: DecryptedOrder[] = [
      { id: 1n, side: "BUY",  remainingDeposit: 2500n * 10n ** 6n, remainingRequest: 1n * 10n ** 18n, assetDecimals: 18, cashDecimals: 6 },
      { id: 2n, side: "SELL", remainingDeposit: 1n * 10n ** 18n,   remainingRequest: 2400n * 10n ** 6n, assetDecimals: 18, cashDecimals: 6 },
    ];
    const res = runAuction(orders);
    expect(res.matches).toHaveLength(1);
    const m = res.matches[0]!;
    expect(m.buyOrderId).toBe(1n);
    expect(m.sellOrderId).toBe(2n);
    expect(res.clearingPriceQuotePerBase).toBe(2450n);
    expect(m.assetAmount).toBe(1n * 10n ** 18n);
    expect(m.cashAmount).toBe(2450n * 10n ** 6n);
  });

  it("preserves fractional clearing prices for sub-dollar markets", () => {
    const orders: DecryptedOrder[] = [
      { id: 1n, side: "BUY",  remainingDeposit: 1200n * 10n ** 6n, remainingRequest: 1000n * 10n ** 18n, assetDecimals: 18, cashDecimals: 6 },
      { id: 2n, side: "SELL", remainingDeposit: 2500n * 10n ** 18n, remainingRequest: 2875n * 10n ** 6n, assetDecimals: 18, cashDecimals: 6 },
    ];
    const res = runAuction(orders);
    expect(res.matches).toHaveLength(1);
    expect(res.clearingPriceQuotePerBaseScaled).toBe(1175000000n);
    expect(res.matches[0]!.assetAmount).toBe(1000n * 10n ** 18n);
    expect(res.matches[0]!.cashAmount).toBe(1175n * 10n ** 6n);
  });

  it("returns no matches if no cross", () => {
    const orders: DecryptedOrder[] = [
      { id: 1n, side: "BUY",  remainingDeposit: 2000n * 10n ** 6n, remainingRequest: 1n * 10n ** 18n, assetDecimals: 18, cashDecimals: 6 },
      { id: 2n, side: "SELL", remainingDeposit: 1n * 10n ** 18n,   remainingRequest: 2500n * 10n ** 6n, assetDecimals: 18, cashDecimals: 6 },
    ];
    const res = runAuction(orders);
    expect(res.matches).toHaveLength(0);
  });

  it("scales quote down when buyer's remaining deposit is the binding constraint", () => {
    const orders: DecryptedOrder[] = [
      { id: 1n, side: "BUY",  remainingDeposit: 1000n * 10n ** 6n, remainingRequest: 1n * 10n ** 18n, assetDecimals: 18, cashDecimals: 6 },
      { id: 2n, side: "SELL", remainingDeposit: 2n * 10n ** 18n,   remainingRequest: 1800n * 10n ** 6n, assetDecimals: 18, cashDecimals: 6 },
    ];
    const res = runAuction(orders);
    expect(res.matches).toHaveLength(1);
    const m = res.matches[0]!;
    expect(m.cashAmount).toBeLessThanOrEqual(orders[0]!.remainingDeposit);
  });
});
