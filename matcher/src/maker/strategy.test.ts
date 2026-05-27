import { describe, expect, it } from "vitest";
import { defaultMakerProfiles, MakerPlanError, planMakerBatch } from "./strategy.js";
import type { Deployment } from "../../../shared/addresses/index.js";

const deployment: Deployment = {
  chainId: 421614,
  dex: "0x22598DA7799deA8E3ec5337b1DFCBaa53AFE1e55",
  pairs: [
    {
      id: 0,
      base: { address: "0x5434995Fc33Bf3d074cD905A80F047f3e14b145b", symbol: "eUSDC", decimals: 6 },
      quote: { address: "0xf13d426e12D680F1e7A5d31397F93b0e3ae15df1", symbol: "eWETH", decimals: 18 },
    },
    {
      id: 2,
      base: { address: "0x5434995Fc33Bf3d074cD905A80F047f3e14b145b", symbol: "eUSDC", decimals: 6 },
      quote: { address: "0x70E0e7E2AA8466F7104E34770D2e3E04A46c9bfA", symbol: "eARB", decimals: 18 },
    },
  ],
};

describe("maker strategy", () => {
  it("plans crossing bid and ask pairs deterministically", () => {
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

    const first = planMakerBatch({ deployment, profiles, seed: "same", runId: "run-1" });
    const second = planMakerBatch({ deployment, profiles, seed: "same", runId: "run-1" });

    expect(second).toEqual(first);
    expect(first.orders).toHaveLength(2);
    expect(first.orders[0]!.side).toBe("BUY");
    expect(first.orders[1]!.side).toBe("SELL");
    expect(Number(first.orders[0]!.limitPrice)).toBeGreaterThan(Number(first.orders[1]!.limitPrice));
    expect(first.totalNotionalUSDC).toBe("47");
  });

  it("plans resting markets without crossing", () => {
    const plan = planMakerBatch({
      deployment,
      seed: "resting",
      profiles: [{
        pairId: 0,
        mode: "resting",
        midPrice: "3200",
        minPrice: "2500",
        maxPrice: "4000",
        assetSize: "0.005",
        levels: 1,
        spreadBps: 100,
        jitterBps: 0,
        sizeJitterBps: 0,
        maxNotionalPerOrderUSDC: "40",
        maxNotionalPerBatchUSDC: "90",
      }],
    });

    expect(plan.orders).toHaveLength(2);
    expect(Number(plan.orders[0]!.limitPrice)).toBeLessThan(Number(plan.orders[1]!.limitPrice));
  });

  it("refuses unknown pair ids", () => {
    expect(() => planMakerBatch({
      deployment,
      profiles: [{
        pairId: 99,
        midPrice: "1",
        assetSize: "1",
        maxNotionalPerOrderUSDC: "1",
        maxNotionalPerBatchUSDC: "2",
      }],
    })).toThrow(MakerPlanError);
  });

  it("enforces price bands before orders are submitted", () => {
    expect(() => planMakerBatch({
      deployment,
      profiles: [{
        pairId: 2,
        mode: "crossing",
        midPrice: "1.175",
        minPrice: "1.18",
        maxPrice: "1.3",
        assetSize: "20",
        spreadBps: 100,
        jitterBps: 0,
        sizeJitterBps: 0,
        maxNotionalPerOrderUSDC: "40",
        maxNotionalPerBatchUSDC: "90",
      }],
    })).toThrow(/below/);
  });

  it("caps total order count across default profiles", () => {
    const plan = planMakerBatch({
      deployment,
      profiles: defaultMakerProfiles("crossing").filter((profile) => profile.pairId !== 1 && profile.pairId !== 3),
      seed: "cap",
      maxOrdersPerBatch: 3,
    });

    expect(plan.orders).toHaveLength(3);
    expect(plan.maxOrdersPerBatch).toBe(3);
  });
});
