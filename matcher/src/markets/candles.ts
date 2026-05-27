export const CANDLE_INTERVALS = {
  "1m": 60,
  "5m": 5 * 60,
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
} as const;

export type CandleInterval = keyof typeof CANDLE_INTERVALS;

export type CandleMatchRow = {
  id: bigint;
  pairId: number;
  status: string;
  clearingPriceNum: string | null;
  clearingPriceDen: string | null;
  baseFilled: string | null;
  quoteFilled: string | null;
  settledAt: Date | null;
  publishedAt: Date | null;
};

export type MarketCandle = {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  openNum: string;
  openDen: string;
  highNum: string;
  highDen: string;
  lowNum: string;
  lowDen: string;
  closeNum: string;
  closeDen: string;
  volumeCash: string;
  volumeAsset: string;
  matchCount: number;
};

export type CandleTokenDecimals = {
  cash: number;
  asset: number;
};

type Price = {
  num: bigint;
  den: bigint;
};

type CandleAccumulator = {
  time: number;
  open: Price;
  high: Price;
  low: Price;
  close: Price;
  volumeCash: bigint;
  volumeAsset: bigint;
  matchCount: number;
};

export function parseCandleInterval(value: unknown): CandleInterval {
  if (typeof value === "string" && value in CANDLE_INTERVALS) {
    return value as CandleInterval;
  }
  return "5m";
}

export function parseCandleLimit(value: unknown, defaultLimit = 200, maxLimit = 500): number {
  const raw = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(raw) || raw <= 0) return defaultLimit;
  return Math.min(raw, maxLimit);
}

export function buildCandles(
  rows: CandleMatchRow[],
  interval: CandleInterval,
  limit = 200,
  decimals?: CandleTokenDecimals,
): MarketCandle[] {
  const intervalSec = CANDLE_INTERVALS[interval];
  const buckets = new Map<number, CandleAccumulator>();

  const sorted = rows
    .filter(isSettledMatchWithPrice)
    .sort((a, b) => {
      const aTime = rowTime(a);
      const bTime = rowTime(b);
      if (aTime !== bTime) return aTime - bTime;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  for (const row of sorted) {
    const time = rowTime(row);
    const bucketTime = Math.floor(time / intervalSec) * intervalSec;
    const price = {
      num: BigInt(row.clearingPriceNum!),
      den: BigInt(row.clearingPriceDen!),
    };
    const { volumeCash, volumeAsset } = normalizeVolumes(row, price, decimals);
    const existing = buckets.get(bucketTime);

    if (!existing) {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volumeCash,
        volumeAsset,
        matchCount: 1,
      });
      continue;
    }

    if (comparePrice(price, existing.high) > 0) existing.high = price;
    if (comparePrice(price, existing.low) < 0) existing.low = price;
    existing.close = price;
    existing.volumeCash += volumeCash;
    existing.volumeAsset += volumeAsset;
    existing.matchCount++;
  }

  return [...buckets.values()]
    .sort((a, b) => a.time - b.time)
    .slice(-limit)
    .map(toMarketCandle);
}

function normalizeVolumes(row: CandleMatchRow, price: Price, decimals?: CandleTokenDecimals) {
  const direct = {
    volumeCash: BigInt(row.baseFilled!),
    volumeAsset: BigInt(row.quoteFilled!),
  };
  if (!decimals) return direct;

  const swapped = {
    volumeCash: direct.volumeAsset,
    volumeAsset: direct.volumeCash,
  };
  const directError = priceVolumeError(direct.volumeCash, direct.volumeAsset, price, decimals);
  const swappedError = priceVolumeError(swapped.volumeCash, swapped.volumeAsset, price, decimals);
  return swappedError < directError ? swapped : direct;
}

function priceVolumeError(cashRaw: bigint, assetRaw: bigint, price: Price, decimals: CandleTokenDecimals) {
  const cashScale = 10n ** BigInt(decimals.cash);
  const assetScale = 10n ** BigInt(decimals.asset);
  const left = cashRaw * price.den * assetScale;
  const right = assetRaw * price.num * cashScale;
  return abs(left - right);
}

function abs(value: bigint) {
  return value < 0n ? -value : value;
}

function isSettledMatchWithPrice(row: CandleMatchRow): boolean {
  if (row.status !== "SETTLED") return false;
  if (!row.settledAt && !row.publishedAt) return false;
  if (!isUnsignedInteger(row.clearingPriceNum) || !isUnsignedInteger(row.clearingPriceDen)) return false;
  if (!isUnsignedInteger(row.baseFilled) || !isUnsignedInteger(row.quoteFilled)) return false;
  return BigInt(row.clearingPriceDen!) > 0n;
}

function rowTime(row: CandleMatchRow): number {
  return Math.floor((row.settledAt ?? row.publishedAt)!.getTime() / 1000);
}

function isUnsignedInteger(value: string | null): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function comparePrice(a: Price, b: Price): number {
  const left = a.num * b.den;
  const right = b.num * a.den;
  return left > right ? 1 : left < right ? -1 : 0;
}

function toMarketCandle(candle: CandleAccumulator): MarketCandle {
  return {
    time: candle.time,
    open: formatRatio(candle.open),
    high: formatRatio(candle.high),
    low: formatRatio(candle.low),
    close: formatRatio(candle.close),
    openNum: candle.open.num.toString(),
    openDen: candle.open.den.toString(),
    highNum: candle.high.num.toString(),
    highDen: candle.high.den.toString(),
    lowNum: candle.low.num.toString(),
    lowDen: candle.low.den.toString(),
    closeNum: candle.close.num.toString(),
    closeDen: candle.close.den.toString(),
    volumeCash: candle.volumeCash.toString(),
    volumeAsset: candle.volumeAsset.toString(),
    matchCount: candle.matchCount,
  };
}

function formatRatio(price: Price, decimals = 8): string {
  const whole = price.num / price.den;
  const remainder = price.num % price.den;
  if (remainder === 0n) return whole.toString();

  const scale = 10n ** BigInt(decimals);
  const fraction = (remainder * scale) / price.den;
  const trimmed = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${trimmed}`;
}
