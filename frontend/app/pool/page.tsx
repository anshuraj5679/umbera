"use client";

import { MidnightOrderSubmitter } from "@/components/MidnightOrderSubmitter";
import { PairSnapshot, FlowSection } from "@/components/PairSnapshot";
import { PageHead } from "@/components/atoms";
import { deployment } from "@/lib/dex";
import { useEffect, useState } from "react";

export default function PoolPage() {
  const dep = deployment();
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setMounted(true);
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // Midnight contract batch lifecycle state
  const batchId = 1n;
  const batchOpen = true;
  const orderCount = 2n;
  const batchDuration = 300; // 5 minute sealed batch auction windows
  const openedAt = now > 0 ? Math.floor(now / batchDuration) * batchDuration : 0;
  const remaining = now > 0 ? Math.max(0, openedAt + batchDuration - now) : 300;

  const pair = dep.pairs[0];
  const pairLabel = `${pair.base.symbol} / ${pair.quote.symbol}`;

  const remainingStr = mounted
    ? `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`
    : "05:00";

  return (
    <>
      <PageHead
        num="01 · Trade"
        title="Midnight"
        em="dark pool"
        meta={
          <span suppressHydrationWarning>
            BATCH #{batchId.toString()} · PREVIEW TESTNET<br />
            SEALED WINDOW {remainingStr} REMAINING
          </span>
        }
      />

      <div className="grid-2 grid-2-trade" style={{ gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 0.85fr)", alignItems: "stretch", gap: "24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <MidnightOrderSubmitter />
        </div>
        <div className="col snapshot-col" style={{ gap: 20 }}>
          <PairSnapshot
            pairLabel={pairLabel}
            secondsLeft={remaining}
            batchId={batchId}
            batchOpen={batchOpen}
            orderCount={orderCount}
          />
        </div>
      </div>

      <FlowSection />
    </>
  );
}
