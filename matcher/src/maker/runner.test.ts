import { describe, expect, it } from "vitest";
import { runMakerBatch } from "./runner.js";
import type { AgentOrderRequest, AgentOrderResult } from "../agent/orders.js";
import type { Deployment } from "../../../shared/addresses/index.js";

const deployment: Deployment = {
  chainId: 421614,
  dex: "0x22598DA7799deA8E3ec5337b1DFCBaa53AFE1e55",
  pairs: [{
    id: 2,
    base: { address: "0x5434995Fc33Bf3d074cD905A80F047f3e14b145b", symbol: "eUSDC", decimals: 6 },
    quote: { address: "0x70E0e7E2AA8466F7104E34770D2e3E04A46c9bfA", symbol: "eARB", decimals: 18 },
  }],
};

const profiles = [{
  pairId: 2,
  mode: "crossing" as const,
  midPrice: "1.175",
  minPrice: "1",
  maxPrice: "1.3",
  assetSize: "20",
  levels: 1,
  spreadBps: 100,
  jitterBps: 0,
  sizeJitterBps: 0,
  maxNotionalPerOrderUSDC: "40",
  maxNotionalPerBatchUSDC: "90",
}];

describe("maker runner", () => {
  it("does not submit anything in dry run mode", async () => {
    let submissions = 0;
    const result = await runMakerBatch({
      deployment,
      profiles,
      seed: "dry",
      dryRun: true,
      submitter: {
        async submit() {
          submissions++;
          throw new Error("should not submit");
        },
      },
    });

    expect(result.dryRun).toBe(true);
    expect(result.plan.orders).toHaveLength(2);
    expect(result.submissions).toHaveLength(0);
    expect(submissions).toBe(0);
  });

  it("submits sanitized agent order requests in live mode", async () => {
    const seen: AgentOrderRequest[] = [];
    const result = await runMakerBatch({
      deployment,
      profiles,
      seed: "live",
      runId: "run-live",
      dryRun: false,
      submitter: {
        async submit(input) {
          seen.push(input);
          return {
            ok: true,
            txHash: `0x${"1".repeat(64)}`,
            orderId: String(seen.length),
            batchId: "71",
            pairId: input.pairId,
            expiry: "1",
          } satisfies AgentOrderResult;
        },
      },
    });

    expect(result.dryRun).toBe(false);
    expect(result.submissions).toHaveLength(2);
    expect(seen[0]).toEqual({
      pairId: 2,
      side: "BUY",
      size: "20",
      limitPrice: "1.180875",
      expiryHours: 1,
      clientOrderId: "run-live-p2-l1-bid",
      agent: "obsidian-maker-bot",
    });
    expect(Object.keys(seen[0]!)).not.toContain("pairLabel");
  });
});
