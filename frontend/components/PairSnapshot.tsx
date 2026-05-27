"use client";

import { Card, Cell } from "@/components/atoms";

export function PairSnapshot({
  pairLabel,
  secondsLeft,
  batchId,
  batchOpen,
  orderCount,
}: {
  pairLabel: string;
  secondsLeft: number;
  batchId?: bigint;
  batchOpen?: boolean;
  orderCount?: bigint;
}) {
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  const orderCountLabel = orderCount === undefined ? "-" : orderCount.toString();
  const batchLabel = batchId === undefined ? "-" : `#${batchId.toString()}`;
  const stateLabel = batchOpen === undefined ? "-" : batchOpen ? (secondsLeft === 0 ? "Close Ready" : "Open") : "Closed";
  return (
    <Card title="Pair Snapshot" meta={pairLabel}>
      <div className="snapshot-body">
        <div className="grid-2">
          <Cell label="Current Batch" value={batchLabel} />
          <Cell label="Batch Orders" value={orderCountLabel} encrypted />
          <Cell label="Batch State" value={stateLabel} muted={batchOpen === false} />
          <Cell label="Visibility" value="Sealed" encrypted />
          <Cell label="Auction" value="Uniform Batch" size="sm" muted />
          <Cell label="Matcher" value="Operator Console" size="sm" muted />
        </div>

        <div className="snapshot-chart">
          <div className="snapshot-chart__head">
            <span>Encrypted Queue · Current Batch</span>
            <span>{orderCountLabel} orders</span>
          </div>
          <QueueBars count={Number(orderCount ?? 0n)} />
        </div>

        <div className="snapshot-foot">
          <div>
            <span className="snapshot-foot__label">Next Match Window</span>
            <span className="snapshot-foot__value">~ {m}m {String(s).padStart(2, "0")}s</span>
          </div>
          <div>
            <span className="snapshot-foot__label">Sealed Until</span>
            <span className="snapshot-foot__value">Batch Close</span>
          </div>
          <div>
            <span className="snapshot-foot__label">Auction Type</span>
            <span className="snapshot-foot__value">Sealed Uniform</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function QueueBars({ count }: { count: number }) {
  const slots = 14;
  const active = Math.min(Math.max(count, 0), slots);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${slots}, 1fr)`, gap: 4, alignItems: "end", height: 96 }}>
      {Array.from({ length: slots }).map((_, i) => {
        const isActive = i < active;
        return (
        <div key={i} style={{
          height: isActive ? "76%" : "18%",
          opacity: isActive ? 1 : 0.35,
          background: isActive
            ? "linear-gradient(180deg, oklch(0.72 0.12 152 / 0.75), oklch(0.30 0.05 152 / 0.22))"
            : "oklch(0.28 0.02 240 / 0.35)",
          borderTop: isActive ? "1px solid oklch(0.78 0.12 152 / 0.55)" : "1px solid oklch(0.78 0.02 240 / 0.15)",
        }} />
        );
      })}
    </div>
  );
}

export function FlowSection() {
  return (
    <section style={{ marginTop: 32 }}>
      <Card title="Flow" subtitle="What happens when you submit" meta="CoFHE · SEALED">
        <div className="flow-grid">
          <div className="flow-step">
            <span>01</span>
            <b>Encrypt</b>
            <p>Order fields sealed locally via CoFHE; only handles leave your wallet.</p>
          </div>
          <div className="flow-step">
            <span>02</span>
            <b>Queue</b>
            <p>Submission joins current batch; identity & intent remain hidden.</p>
          </div>
          <div className="flow-step">
            <span>03</span>
            <b>Match</b>
            <p>At window close, the matcher runs a sealed clearing auction.</p>
          </div>
          <div className="flow-step">
            <span>04</span>
            <b>Settle</b>
            <p>Net deltas settle on-chain; remainders are claimable.</p>
          </div>
        </div>
      </Card>
    </section>
  );
}
