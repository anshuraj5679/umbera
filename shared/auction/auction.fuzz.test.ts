import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { runAuction } from "./auction.js";
import type { DecryptedOrder } from "./types.js";

describe("runAuction properties", () => {
  it("matched quote ≤ buyer's deposit (no buyer drain)", () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        side: fc.oneof(fc.constant<"BUY">("BUY"), fc.constant<"SELL">("SELL")),
        amt: fc.bigInt(1n, 10n ** 24n),
        req: fc.bigInt(1n, 10n ** 24n),
      }), { minLength: 0, maxLength: 20 }),
      (raws) => {
        const orders: DecryptedOrder[] = raws.map((r, i) => ({
          id: BigInt(i + 1), side: r.side,
          remainingDeposit: r.amt, remainingRequest: r.req,
          assetDecimals: 18, cashDecimals: 6,
        }));
        const { matches } = runAuction(orders);
        const depositByBuy = new Map<bigint, bigint>();
        for (const o of orders) if (o.side === "BUY") depositByBuy.set(o.id, o.remainingDeposit);
        const spentByBuy = new Map<bigint, bigint>();
        for (const m of matches) {
          spentByBuy.set(m.buyOrderId, (spentByBuy.get(m.buyOrderId) ?? 0n) + m.cashAmount);
        }
        for (const [buyOrderId, spent] of spentByBuy) {
          const dep = depositByBuy.get(buyOrderId) ?? 0n;
          expect(spent).toBeLessThanOrEqual(dep);
        }
      },
    ), { numRuns: 200 });
  });
});
