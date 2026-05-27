import { describe, expect, it } from "vitest";
import { AgentOrderError, buildOrderAmounts, toUnits } from "./orders.js";
import type { Deployment } from "../../../shared/addresses/index.js";

const pair: Deployment["pairs"][number] = {
  id: 0,
  base: { address: "0x5434995Fc33Bf3d074cD905A80F047f3e14b145b", symbol: "eUSDC", decimals: 6 },
  quote: { address: "0xf13d426e12D680F1e7A5d31397F93b0e3ae15df1", symbol: "eWETH", decimals: 18 },
};

describe("agent order amount builder", () => {
  it("converts decimals without silent precision loss", () => {
    expect(toUnits("1.25", 6)).toBe(1_250_000n);
    expect(() => toUnits("1.0000001", 6)).toThrow(AgentOrderError);
  });

  it("builds BUY deposit as cash and request as asset", () => {
    const result = buildOrderAmounts({
      side: "BUY",
      size: "0.5",
      limitPrice: "3200",
      pair,
      maxNotionalUSDC: "10000",
    });

    expect(result.cashRaw).toBe(1_600_000_000n);
    expect(result.depositRaw).toBe(result.cashRaw);
    expect(result.requestRaw).toBe(500_000_000_000_000_000n);
    expect(result.depositToken).toBe("eUSDC");
    expect(result.requestToken).toBe("eWETH");
  });

  it("builds SELL deposit as asset and request as cash", () => {
    const result = buildOrderAmounts({
      side: "SELL",
      size: "0.5",
      limitPrice: "3200",
      pair,
      maxNotionalUSDC: "10000",
    });

    expect(result.depositRaw).toBe(500_000_000_000_000_000n);
    expect(result.requestRaw).toBe(1_600_000_000n);
    expect(result.depositToken).toBe("eWETH");
    expect(result.requestToken).toBe("eUSDC");
  });
});
