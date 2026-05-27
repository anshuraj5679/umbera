import { describe, expect, it } from "vitest";
import { evaluateBatchReadiness } from "./batch-matcher.js";

describe("batch matcher readiness", () => {
  it("waits for the configured close-to-match delay before matching", () => {
    const result = evaluateBatchReadiness({
      indexedOrderCount: 2n,
      onChainOrderCount: 2n,
      closedAt: new Date("2026-05-25T12:00:00.000Z"),
      now: new Date("2026-05-25T12:00:09.000Z"),
      matchDelaySec: 15,
    });

    expect(result.status).toBe("WAITING_DELAY");
    expect(result.status === "WAITING_DELAY" ? result.readyAt.toISOString() : null)
      .toBe("2026-05-25T12:00:15.000Z");
  });

  it("keeps a closed batch retryable while indexed orders lag on-chain count", () => {
    const result = evaluateBatchReadiness({
      indexedOrderCount: 1n,
      onChainOrderCount: 2n,
      closedAt: new Date("2026-05-25T12:00:00.000Z"),
      now: new Date("2026-05-25T12:01:00.000Z"),
      matchDelaySec: 15,
    });

    expect(result.status).toBe("INDEX_INCOMPLETE");
    expect(result.indexedOrderCount).toBe(1n);
    expect(result.onChainOrderCount).toBe(2n);
  });

  it("allows empty batches to become matched-empty only after completeness is known", () => {
    const result = evaluateBatchReadiness({
      indexedOrderCount: 0n,
      onChainOrderCount: 0n,
      closedAt: new Date("2026-05-25T12:00:00.000Z"),
      now: new Date("2026-05-25T12:01:00.000Z"),
      matchDelaySec: 15,
    });

    expect(result.status).toBe("READY");
  });
});
