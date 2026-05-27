"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatUnits } from "viem";
import { Card, Cell, Empty, Pill, SelectNative } from "@/components/atoms";
import { deployment } from "@/lib/dex";

const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
type CandleInterval = (typeof INTERVALS)[number];

type Candle = {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeCash: string;
  volumeAsset: string;
  matchCount: number;
};

type CandleResponse = {
  pairId: number;
  interval: CandleInterval;
  candles: Candle[];
};

type PairView = {
  id: number;
  label: string;
  baseSymbol: string;
  quoteSymbol: string;
  baseDecimals: number;
  quoteDecimals: number;
};

export function MarketCandles() {
  const pairs = useMemo<PairView[]>(() => {
    return deployment().pairs.map((pair) => ({
      id: pair.id,
      label: `${cleanSymbol(pair.quote.symbol)} / ${cleanSymbol(pair.base.symbol)}`,
      baseSymbol: cleanSymbol(pair.base.symbol),
      quoteSymbol: cleanSymbol(pair.quote.symbol),
      baseDecimals: pair.base.decimals,
      quoteDecimals: pair.quote.decimals,
    }));
  }, []);

  const [pairId, setPairId] = useState(() => String(pairs[0]?.id ?? 0));
  const [interval, setIntervalValue] = useState<CandleInterval>("5m");
  const [data, setData] = useState<CandleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activePair = pairs.find((pair) => String(pair.id) === pairId) ?? pairs[0];

  const loadCandles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/markets/${pairId}/candles?interval=${interval}&limit=160`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? `request failed: ${response.status}`);
      }
      setData(payload);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [interval, pairId]);

  useEffect(() => {
    void loadCandles();
    const timer = window.setInterval(() => void loadCandles(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadCandles]);

  const candles = data?.candles ?? [];
  const stats = useMemo(() => summarize(candles, activePair), [candles, activePair]);

  return (
    <div className="market-stack">
      <Card
        title="Live Market"
        subtitle="Matcher API candles"
        meta={<Pill kind={error ? "bad" : "ok"}>{error ? "OFFLINE" : "LIVE"}</Pill>}
      >
        <div className="market-toolbar">
          <SelectNative
            value={pairId}
            onChange={setPairId}
            options={pairs.map((pair) => ({ value: String(pair.id), label: pair.label }))}
          />

          <div className="market-intervals" role="tablist" aria-label="Candle interval">
            {INTERVALS.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={interval === value}
                className={interval === value ? "is-active" : ""}
                onClick={() => setIntervalValue(value)}
              >
                {value}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn btn--ghost btn--sm market-refresh"
            onClick={() => void loadCandles()}
            disabled={loading}
            title="Refresh candles"
            aria-label="Refresh candles"
          >
            <RefreshCw size={14} aria-hidden />
          </button>
        </div>

        <div className="market-stats">
          <Cell label={`Last ${activePair?.baseSymbol ?? "USDC"}`} value={stats.last} size="lg" />
          <Cell label="Session Range" value={stats.range} muted />
          <Cell label={`Volume ${activePair?.baseSymbol ?? "USDC"}`} value={stats.cashVolume} encrypted />
          <Cell label={`Volume ${activePair?.quoteSymbol ?? "ASSET"}`} value={stats.assetVolume} muted />
        </div>

        <div className="market-chart" aria-busy={loading}>
          {error ? (
            <Empty>{error}</Empty>
          ) : candles.length === 0 && !loading ? (
            <Empty>NO SETTLED CANDLES</Empty>
          ) : (
            <CandleChart candles={candles} />
          )}
        </div>
      </Card>

      <Card
        title="Recent Candles"
        subtitle={activePair?.label ?? "Market"}
        meta={`${candles.length} buckets`}
      >
        <div className="table-wrap market-table">
          <table className="tbl">
            <thead>
              <tr>
                <th>Time</th>
                <th>Open</th>
                <th>High</th>
                <th>Low</th>
                <th>Close</th>
                <th>Matches</th>
                <th style={{ textAlign: "right" }}>Volume</th>
              </tr>
            </thead>
            <tbody>
              {candles.slice(-12).reverse().map((candle) => (
                <tr key={candle.time}>
                  <td>{formatDateTime(candle.time)}</td>
                  <td>{formatPrice(candle.open)}</td>
                  <td>{formatPrice(candle.high)}</td>
                  <td>{formatPrice(candle.low)}</td>
                  <td><b style={{ color: "var(--silver-edge)" }}>{formatPrice(candle.close)}</b></td>
                  <td>{candle.matchCount}</td>
                  <td style={{ textAlign: "right" }}>
                    {activePair ? formatTokenAmount(candle.volumeCash, activePair.baseDecimals) : "-"}
                  </td>
                </tr>
              ))}
              {candles.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <Empty>{loading ? "LOADING CANDLES" : "NO SETTLED CANDLES"}</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function CandleChart({ candles }: { candles: Candle[] }) {
  const width = 960;
  const height = 360;
  const left = 70;
  const right = 28;
  const top = 24;
  const bottom = 46;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const volumeH = 58;

  const points = candles.map((candle) => ({
    ...candle,
    openN: Number(candle.open),
    highN: Number(candle.high),
    lowN: Number(candle.low),
    closeN: Number(candle.close),
    volumeN: Number(candle.volumeCash),
  })).filter((candle) => (
    Number.isFinite(candle.openN) &&
    Number.isFinite(candle.highN) &&
    Number.isFinite(candle.lowN) &&
    Number.isFinite(candle.closeN)
  ));

  if (points.length === 0) {
    return <Empty>LOADING CANDLES</Empty>;
  }

  const rawHigh = Math.max(...points.map((point) => point.highN));
  const rawLow = Math.min(...points.map((point) => point.lowN));
  const pad = rawHigh === rawLow
    ? Math.max(Math.abs(rawHigh) * 0.02, 1)
    : (rawHigh - rawLow) * 0.08;
  const priceHigh = rawHigh + pad;
  const priceLow = Math.max(0, rawLow - pad);
  const priceRange = priceHigh - priceLow || 1;
  const maxVolume = Math.max(...points.map((point) => point.volumeN), 1);
  const step = plotW / Math.max(points.length, 1);
  const bodyW = Math.max(6, Math.min(16, step * 0.56));
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = priceHigh - (index / 4) * priceRange;
    return { value, y: yFor(value) };
  });
  const timeLabels = timeMarkers(points);

  function yFor(value: number) {
    return top + ((priceHigh - value) / priceRange) * plotH;
  }

  function xFor(index: number) {
    return left + step * index + step / 2;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Settled market candlestick chart">
      <rect x={0} y={0} width={width} height={height} rx={4} fill="rgba(14,14,18,0.38)" />
      {grid.map((line) => (
        <g key={line.value}>
          <line x1={left} x2={width - right} y1={line.y} y2={line.y} stroke="rgba(232,233,236,0.10)" />
          <text x={12} y={line.y + 4} fill="var(--silver-4)" fontSize={11} fontFamily="var(--mono)">
            {formatPrice(String(line.value))}
          </text>
        </g>
      ))}
      {points.map((point, index) => {
        const x = xFor(index);
        const up = point.closeN >= point.openN;
        const color = up ? "var(--emerald)" : "var(--red)";
        const fill = up ? "rgba(91, 219, 151, 0.24)" : "rgba(231, 111, 91, 0.24)";
        const openY = yFor(point.openN);
        const closeY = yFor(point.closeN);
        const highY = yFor(point.highN);
        const lowY = yFor(point.lowN);
        const bodyTop = Math.min(openY, closeY);
        const bodyH = Math.max(2, Math.abs(closeY - openY));
        const volumeHeight = Math.max(2, (point.volumeN / maxVolume) * volumeH);
        return (
          <g key={`${point.time}-${index}`}>
            <title>{`${formatDateTime(point.time)} O ${formatPrice(point.open)} H ${formatPrice(point.high)} L ${formatPrice(point.low)} C ${formatPrice(point.close)}`}</title>
            <rect
              x={x - bodyW / 2}
              y={height - bottom - volumeHeight}
              width={bodyW}
              height={volumeHeight}
              fill={fill}
              opacity={0.55}
            />
            <line x1={x} x2={x} y1={highY} y2={lowY} stroke={color} strokeWidth={1.35} />
            <rect
              x={x - bodyW / 2}
              y={bodyTop}
              width={bodyW}
              height={bodyH}
              fill={fill}
              stroke={color}
              strokeWidth={1.2}
            />
          </g>
        );
      })}
      <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} stroke="rgba(232,233,236,0.18)" />
      {timeLabels.map((label) => (
        <text key={label.x} x={label.x} y={height - 16} textAnchor={label.anchor} fill="var(--silver-4)" fontSize={11} fontFamily="var(--mono)">
          {formatShortTime(label.time)}
        </text>
      ))}
    </svg>
  );
}

function summarize(candles: Candle[], pair?: PairView) {
  if (!pair || candles.length === 0) {
    return { last: "-", range: "-", cashVolume: "-", assetVolume: "-" };
  }

  const last = candles[candles.length - 1]!;
  const high = Math.max(...candles.map((candle) => Number(candle.high)));
  const low = Math.min(...candles.map((candle) => Number(candle.low)));
  const cashVolume = candles.reduce((sum, candle) => sum + BigInt(candle.volumeCash), 0n);
  const assetVolume = candles.reduce((sum, candle) => sum + BigInt(candle.volumeAsset), 0n);

  return {
    last: formatPrice(last.close),
    range: `${formatPrice(String(low))} - ${formatPrice(String(high))}`,
    cashVolume: formatTokenAmount(cashVolume.toString(), pair.baseDecimals),
    assetVolume: formatTokenAmount(assetVolume.toString(), pair.quoteDecimals),
  };
}

function timeMarkers(points: Array<{ time: number }>) {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (points.length === 1) {
    return [{ time: first.time, x: 480, anchor: "middle" as const }];
  }
  const middle = points[Math.floor(points.length / 2)]!;
  return [
    { time: first.time, x: 70, anchor: "start" as const },
    { time: middle.time, x: 480, anchor: "middle" as const },
    { time: last.time, x: 932, anchor: "end" as const },
  ];
}

function cleanSymbol(symbol: string) {
  return symbol.replace(/^e/, "");
}

function formatPrice(value: string) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "-";
  if (numberValue >= 1_000) return numberValue.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (numberValue >= 1) return numberValue.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return numberValue.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function formatTokenAmount(raw: string, decimals: number) {
  try {
    const numberValue = Number(formatUnits(BigInt(raw), decimals));
    if (!Number.isFinite(numberValue)) return "-";
    return numberValue.toLocaleString(undefined, { maximumFractionDigits: numberValue >= 1 ? 4 : 6 });
  } catch {
    return "-";
  }
}

function formatDateTime(time: number) {
  return new Date(time * 1000).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortTime(time: number) {
  return new Date(time * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
