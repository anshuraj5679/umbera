"use client";

import { MidnightOrderSubmitter } from "@/components/MidnightOrderSubmitter";
import { PairSnapshot, FlowSection } from "@/components/PairSnapshot";
import { PageHead } from "@/components/atoms";
import { deployment } from "@/lib/dex";
import { useMidnight } from "@/midnight";
import { useEffect, useState } from "react";

export default function PoolPage() {
  const dep = deployment();
  const [mounted, setMounted] = useState(false);
  const { batchId, batchOpen, remainingSeconds, orderCount, ordersInBatch, closeBatch } = useMidnight();

  useEffect(() => {
    setMounted(true);
  }, []);

  const pair = dep.pairs[0];
  const pairLabel = `${pair.base.symbol} / ${pair.quote.symbol}`;

  const remainingStr = mounted
    ? `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`
    : "05:00";

  return (
    <>
      <PageHead
        num="01 · Trade"
        title="Midnight"
        em="dark pool"
        meta={
          <span suppressHydrationWarning>
            BATCH #{mounted ? batchId.toString() : "1"} · PREVIEW TESTNET<br />
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
            secondsLeft={remainingSeconds}
            batchId={batchId}
            batchOpen={batchOpen}
            orderCount={orderCount}
            orders={ordersInBatch}
            onCloseBatch={closeBatch}
          />
        </div>
      </div>

      <FlowSection />
    </>
  );
}
