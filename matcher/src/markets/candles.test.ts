import { describe, expect, it } from "vitest";
import { buildCandles, parseCandleInterval, parseCandleLimit, type CandleMatchRow } from "./candles.js";

const baseRow = {
  pairId: 2,
  status: "SETTLED",
  baseFilled: "1000000",
  quoteFilled: "1000000000000000000",
  publishedAt: null,
};

type RowArgs = Omit<Partial<CandleMatchRow>, "id" | "clearingPriceNum" | "clearingPriceDen" | "settledAt"> & {
  id: bigint;
  priceNum: string;
  priceDen: string;
  settledAt: string;
};

function row(args: RowArgs): CandleMatchRow {
  return {
    ...baseRow,
    id: args.id,
    pairId: args.pairId ?? baseRow.pairId,
    status: args.status ?? baseRow.status,
    clearingPriceNum: args.priceNum,
    clearingPriceDen: args.priceDen,
    baseFilled: args.baseFilled ?? baseRow.baseFilled,
    quoteFilled: args.quoteFilled ?? baseRow.quoteFilled,
    settledAt: new Date(args.settledAt),
    publishedAt: args.publishedAt ?? baseRow.publishedAt,
  };
}

describe("market candles", () => {
  it("groups settled matches into OHLCV buckets", () => {
    const candles = buildCandles([
      row({ id: 1n, priceNum: "1000000000", priceDen: "1000000000", settledAt: "2026-05-24T14:00:01Z", baseFilled: "100", quoteFilled: "10" }),
      row({ id: 2n, priceNum: "1200000000", priceDen: "1000000000", settledAt: "2026-05-24T14:02:00Z", baseFilled: "200", quoteFilled: "20" }),
      row({ id: 3n, priceNum: "900000000", priceDen: "1000000000", settledAt: "2026-05-24T14:04:59Z", baseFilled: "300", quoteFilled: "30" }),
      row({ id: 4n, priceNum: "1100000000", priceDen: "1000000000", settledAt: "2026-05-24T14:05:00Z", baseFilled: "400", quoteFilled: "40" }),
    ], "5m");

    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({
      open: "1",
      high: "1.2",
      low: "0.9",
      close: "0.9",
      volumeCash: "600",
      volumeAsset: "60",
      matchCount: 3,
    });
    expect(candles[1]).toMatchObject({
      open: "1.1",
      high: "1.1",
      low: "1.1",
      close: "1.1",
      volumeCash: "400",
      volumeAsset: "40",
      matchCount: 1,
    });
  });

  it("preserves fractional clearing prices", () => {
    const candles = buildCandles([
      row({ id: 1n, priceNum: "1175000000", priceDen: "1000000000", settledAt: "2026-05-24T14:00:01Z" }),
    ], "5m");

    expect(candles[0]!.open).toBe("1.175");
    expect(candles[0]!.openNum).toBe("1175000000");
    expect(candles[0]!.openDen).toBe("1000000000");
  });

  it("normalizes legacy rows that stored cash and asset fills in reverse order", () => {
    const candles = buildCandles([
      row({
        id: 1n,
        pairId: 0,
        priceNum: "3200000000000",
        priceDen: "1000000000",
        baseFilled: "250000000000000000",
        quoteFilled: "800000000",
        settledAt: "2026-05-24T14:00:01Z",
      }),
      row({
        id: 2n,
        pairId: 0,
        priceNum: "3200000000000",
        priceDen: "1000000000",
        baseFilled: "800000000",
        quoteFilled: "250000000000000000",
        settledAt: "2026-05-24T14:02:00Z",
      }),
    ], "5m", 200, { cash: 6, asset: 18 });

    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({
      volumeCash: "1600000000",
      volumeAsset: "500000000000000000",
      matchCount: 2,
    });
  });

  it("ignores non-settled and incomplete rows", () => {
    const candles = buildCandles([
      row({ id: 1n, priceNum: "1000000000", priceDen: "1000000000", settledAt: "2026-05-24T14:00:01Z" }),
      row({ id: 2n, status: "PENDING", priceNum: "999000000", priceDen: "1000000000", settledAt: "2026-05-24T14:00:02Z" }),
      { ...row({ id: 3n, priceNum: "999000000", priceDen: "1000000000", settledAt: "2026-05-24T14:00:03Z" }), clearingPriceNum: null },
    ], "5m");

    expect(candles).toHaveLength(1);
    expect(candles[0]!.matchCount).toBe(1);
  });

  it("parses safe defaults for interval and limit", () => {
    expect(parseCandleInterval("1m")).toBe("1m");
    expect(parseCandleInterval("bad")).toBe("5m");
    expect(parseCandleLimit("10")).toBe(10);
    expect(parseCandleLimit("-1")).toBe(200);
    expect(parseCandleLimit("9999")).toBe(500);
  });
});
