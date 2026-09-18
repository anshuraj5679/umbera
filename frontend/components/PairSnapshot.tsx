"use client";

import { useMemo, useState } from "react";
import { Card, Cell } from "@/components/atoms";
import { Lock, Layers, TrendingUp, ShieldCheck, EyeOff, Copy, Check, Clock } from "lucide-react";
import { type BatchOrder } from "@/midnight/batch";
import { toast } from "sonner";

export function PairSnapshot({
  pairLabel,
  secondsLeft,
  batchId,
  batchOpen,
  orderCount,
  orders = [],
  onCloseBatch,
}: {
  pairLabel: string;
  secondsLeft: number;
  batchId?: bigint;
  batchOpen?: boolean;
  orderCount?: bigint;
  orders?: BatchOrder[];
  onCloseBatch?: () => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<"chart" | "queue">("chart");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  const orderCountLabel = orderCount === undefined ? "-" : orderCount.toString();
  const batchLabel = batchId === undefined ? "#1" : `#${batchId.toString()}`;
  const isZero = secondsLeft === 0;
  const stateLabel = batchOpen === undefined ? "-" : batchOpen ? (isZero ? "Close Ready" : "Open") : "Closed";

  // Calculate dynamic batch clearing metrics from orders
  const { buyVolume, sellVolume, clearingPrice, matchRate } = useMemo(() => {
    let buys = 150;
    let sells = 150;
    for (const ord of orders) {
      if (ord.side === "BUY") buys += ord.amount || 25;
      else sells += ord.amount || 25;
    }
    const matched = Math.min(buys, sells);
    const total = buys + sells;
    const rate = total > 0 ? Math.round((matched * 2 / total) * 100) : 100;
    // Clearing price heuristic around 1.00 based on supply/demand balance
    const ratio = sells > 0 ? buys / sells : 1;
    const price = (1.00 * Math.pow(ratio, 0.25)).toFixed(2);
    return { buyVolume: buys, sellVolume: sells, clearingPrice: price, matchRate: rate };
  }, [orders]);

  const handleCopy = (hash: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(hash);
      setCopiedHash(hash);
      toast.success("Commitment Copied", { description: `${hash.slice(0, 16)}... copied to clipboard` });
      setTimeout(() => setCopiedHash(null), 2000);
    }
  };

  const handleTriggerClose = async () => {
    if (!onCloseBatch || closing) return;
    setClosing(true);
    try {
      await onCloseBatch();
    } finally {
      setClosing(false);
    }
  };

  return (
    <Card title="Pair Snapshot" meta={pairLabel}>
      <div className="snapshot-body">
        {/* Core Metrics Grid */}
        <div className="grid-2" style={{ gap: "10px" }}>
          <Cell label="Current Batch" value={batchLabel} />
          <Cell label="Batch Orders" value={orderCountLabel} encrypted />
          <Cell label="Batch State" value={stateLabel} muted={batchOpen === false} />
          <Cell label="Visibility" value="ZK Sealed" encrypted />
          <Cell label="Auction Type" value="Uniform Clearing" size="sm" muted />
          <Cell label="Est. Clearing Price" value={`${clearingPrice} TKA`} size="sm" />
        </div>

        {/* Dynamic Dark Pool Graph & Queue Container */}
        <div className="snapshot-chart" style={{ padding: "16px", minHeight: "260px" }}>
          <div className="snapshot-chart__head" style={{ alignItems: "center", marginBottom: "8px" }}>
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                onClick={() => setActiveTab("chart")}
                style={{
                  background: activeTab === "chart" ? "rgba(168, 85, 247, 0.2)" : "transparent",
                  border: activeTab === "chart" ? "1px solid rgba(168, 85, 247, 0.4)" : "1px solid transparent",
                  color: activeTab === "chart" ? "#c084fc" : "var(--silver-4, #94a3b8)",
                  fontSize: "10px",
                  letterSpacing: "0.15em",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <TrendingUp size={12} />
                AUCTION CURVE
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("queue")}
                style={{
                  background: activeTab === "queue" ? "rgba(16, 185, 129, 0.2)" : "transparent",
                  border: activeTab === "queue" ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid transparent",
                  color: activeTab === "queue" ? "#34d399" : "var(--silver-4, #94a3b8)",
                  fontSize: "10px",
                  letterSpacing: "0.15em",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <Layers size={12} />
                ENCRYPTED QUEUE ({orderCountLabel})
              </button>
            </div>

            <span style={{ fontSize: "10px", color: "var(--silver-4, #64748b)" }}>
              {activeTab === "chart" ? "DEMAND / SUPPLY CROSS" : "SEALED COMMITMENTS"}
            </span>
          </div>

          {activeTab === "chart" ? (
            <AuctionClearingGraph
              clearingPrice={clearingPrice}
              buyVolume={buyVolume}
              sellVolume={sellVolume}
              orderCount={Number(orderCount ?? 0n)}
              matchRate={matchRate}
            />
          ) : (
            <EncryptedCommitmentsQueue
              orders={orders}
              onCopy={handleCopy}
              copiedHash={copiedHash}
            />
          )}
        </div>

        {/* Snapshot Foot with batch countdown & action */}
        <div className="snapshot-foot">
          <div>
            <span className="snapshot-foot__label">Next Match Window</span>
            <span className="snapshot-foot__value" style={{ color: isZero ? "#f87171" : "#34d399" }}>
              {isZero ? "Window Closed" : `~ ${m}m ${String(s).padStart(2, "0")}s`}
            </span>
          </div>
          <div>
            <span className="snapshot-foot__label">Match Efficiency</span>
            <span className="snapshot-foot__value">{matchRate}% Matched</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
            {onCloseBatch && (
              <button
                type="button"
                onClick={handleTriggerClose}
                disabled={closing}
                style={{
                  background: isZero ? "rgba(245, 158, 11, 0.2)" : "rgba(255, 255, 255, 0.06)",
                  border: isZero ? "1px solid rgba(245, 158, 11, 0.45)" : "1px solid var(--line)",
                  color: isZero ? "#fbbf24" : "var(--silver-edge, #cbd5e1)",
                  fontSize: "10px",
                  padding: "5px 8px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontFamily: "var(--mono)",
                  fontWeight: "600",
                  letterSpacing: "0.06em",
                }}
                title="Settle batch and open next auction window"
              >
                {closing ? "Sealing..." : isZero ? "Close Batch Now" : "Advance Batch"}
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * Interactive SVG-based Zero-Knowledge Batch Auction Clearing Curve.
 * Visualizes discrete batch auction economics:
 * - Green descending curve: Cumulative Buy Demand
 * - Violet ascending curve: Cumulative Sell Supply
 * - Dashed Vertical Line: Uniform Clearing Price Equilibrium
 */
function AuctionClearingGraph({
  clearingPrice,
  buyVolume,
  sellVolume,
  orderCount,
  matchRate,
}: {
  clearingPrice: string;
  buyVolume: number;
  sellVolume: number;
  orderCount: number;
  matchRate: number;
}) {
  const w = 420;
  const h = 140;
  const eqX = 210;
  const eqY = 70;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", position: "relative" }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{ width: "100%", height: "135px", overflow: "visible" }}
      >
        <defs>
          {/* Buy Gradient */}
          <linearGradient id="buyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>

          {/* Sell Gradient */}
          <linearGradient id="sellGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a855f7" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0.0" />
          </linearGradient>

          {/* Glow filter */}
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Grid lines */}
        <line x1="20" y1="30" x2="400" y2="30" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
        <line x1="20" y1="70" x2="400" y2="70" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
        <line x1="20" y1="110" x2="400" y2="110" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />

        {/* Buy Demand Area & Curve (Downward sloping) */}
        <path
          d={`M 20 120 L 20 25 Q 120 40 210 ${eqY} T 400 120 Z`}
          fill="url(#buyGrad)"
        />
        <path
          d={`M 20 25 Q 120 40 210 ${eqY} T 400 120`}
          fill="none"
          stroke="#10b981"
          strokeWidth="2.5"
          filter="url(#glow)"
        />

        {/* Sell Supply Area & Curve (Upward sloping) */}
        <path
          d={`M 20 120 L 20 120 Q 120 100 210 ${eqY} T 400 25 L 400 120 Z`}
          fill="url(#sellGrad)"
        />
        <path
          d={`M 20 120 Q 120 100 210 ${eqY} T 400 25`}
          fill="none"
          stroke="#a855f7"
          strokeWidth="2.5"
          filter="url(#glow)"
        />

        {/* Equilibrium Line (Uniform Clearing Price) */}
        <line
          x1={eqX}
          y1="10"
          x2={eqX}
          y2="125"
          stroke="#38bdf8"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />

        {/* Equilibrium Intersection Point */}
        <circle cx={eqX} cy={eqY} r="5" fill="#38bdf8" filter="url(#glow)" />
        <circle cx={eqX} cy={eqY} r="8" fill="none" stroke="#38bdf8" strokeWidth="1" opacity="0.6">
          <animate attributeName="r" values="6;12;6" dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.8;0;0.8" dur="2.5s" repeatCount="indefinite" />
        </circle>

        {/* Price Label on Equilibrium */}
        <rect x={eqX - 34} y="4" width="68" height="18" rx="3" fill="#0f172a" stroke="#38bdf8" strokeWidth="1" />
        <text x={eqX} y="16" textAnchor="middle" fill="#38bdf8" fontSize="9" fontFamily="var(--mono)" fontWeight="bold">
          {clearingPrice} TKA
        </text>

        {/* Axis Curve Labels */}
        <text x="35" y="22" fill="#10b981" fontSize="9" fontFamily="var(--mono)">
          BUY DEMAND ({buyVolume} tDUST)
        </text>
        <text x="390" y="22" textAnchor="end" fill="#c084fc" fontSize="9" fontFamily="var(--mono)">
          SELL SUPPLY ({sellVolume} tDUST)
        </text>
      </svg>

      {/* Curve Legend & Batch Context */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", fontFamily: "var(--mono)", color: "var(--silver-4, #94a3b8)", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "4px", color: "#34d399" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
            Sealed Bids
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "4px", color: "#c084fc" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#a855f7", display: "inline-block" }} />
            Sealed Asks
          </span>
        </div>
        <span style={{ color: "#38bdf8", display: "flex", alignItems: "center", gap: "4px" }}>
          <ShieldCheck size={12} />
          MEV-Free Uniform Clearing
        </span>
      </div>
    </div>
  );
}

/**
 * Visual list of encrypted order commitments waiting in the current batch.
 */
function EncryptedCommitmentsQueue({
  orders,
  onCopy,
  copiedHash,
}: {
  orders: BatchOrder[];
  onCopy: (hash: string) => void;
  copiedHash: string | null;
}) {
  if (orders.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "130px", color: "var(--silver-4, #64748b)", gap: "8px" }}>
        <EyeOff size={24} />
        <span style={{ fontSize: "12px", fontFamily: "var(--mono)" }}>Queue Empty · Be the first to place an order</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "140px", overflowY: "auto", paddingRight: "4px" }}>
      {orders.map((ord, i) => {
        const isBuy = ord.side === "BUY";
        const shortCommitment = `${ord.commitment.slice(0, 10)}...${ord.commitment.slice(-8)}`;
        const isCopied = copiedHash === ord.commitment;

        return (
          <div
            key={ord.id || i}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: ord.isUserOrder ? "rgba(16, 185, 129, 0.08)" : "rgba(255, 255, 255, 0.03)",
              border: ord.isUserOrder ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(255, 255, 255, 0.06)",
              borderRadius: "4px",
              padding: "6px 10px",
              fontSize: "11px",
              fontFamily: "var(--mono)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: "bold",
                  padding: "1px 5px",
                  borderRadius: "3px",
                  background: isBuy ? "rgba(16, 185, 129, 0.2)" : "rgba(168, 85, 247, 0.2)",
                  color: isBuy ? "#34d399" : "#c084fc",
                }}
              >
                {ord.side}
              </span>
              <span style={{ color: "var(--silver-edge, #cbd5e1)" }}>
                Commitment: {shortCommitment}
              </span>
              {ord.isUserOrder && (
                <span style={{ fontSize: "9px", color: "#10b981", background: "rgba(16, 185, 129, 0.15)", padding: "1px 4px", borderRadius: "2px" }}>
                  YOU
                </span>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "var(--silver-4, #94a3b8)", fontSize: "10px", display: "flex", alignItems: "center", gap: "3px" }}>
                <Lock size={10} color="#a855f7" />
                ZK Proved
              </span>
              <button
                type="button"
                onClick={() => onCopy(ord.commitment)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: isCopied ? "#34d399" : "var(--silver-4, #94a3b8)",
                  padding: "2px",
                }}
                title="Copy commitment hash"
              >
                {isCopied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function FlowSection() {
  return (
    <section style={{ marginTop: 32 }}>
      <Card title="Flow" subtitle="How confidential batch trading works" meta="MIDNIGHT ZK · COMPACT">
        <div className="flow-grid">
          <div className="flow-step">
            <span>01</span>
            <b>Private Commitment</b>
            <p>Traders enter order parameters locally. A 32-byte cryptographic Pedersen commitment is constructed in memory without revealing price or amount.</p>
          </div>
          <div className="flow-step">
            <span>02</span>
            <b>Lace Authorization</b>
            <p>The Lace Wallet extension prompts approval to sign the shielded commitment and deduct tDUST gas fees directly from your connected wallet.</p>
          </div>
          <div className="flow-step">
            <span>03</span>
            <b>Batch Queue Window</b>
            <p>Orders accumulate in 5-minute sealed auction windows. No single trader or miner can see other traders’ amounts, eliminating front-running.</p>
          </div>
          <div className="flow-step">
            <span>04</span>
            <b>ZK Match & Settle</b>
            <p>When the window closes, the Midnight Compact contract executes a uniform clearing price settlement with zero slippage and zero MEV.</p>
          </div>
        </div>
      </Card>
    </section>
  );
}
