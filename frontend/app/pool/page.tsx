"use client";

import { OrderEntryForm } from "@/components/OrderEntryForm";
import { PairSnapshot, FlowSection } from "@/components/PairSnapshot";
import { PageHead } from "@/components/atoms";
import { useReadContracts } from "wagmi";
import { dexAbi, deployment } from "@/lib/dex";
import { useEffect, useState } from "react";

export default function PoolPage() {
  const dep = deployment();
  const dexAddr = dep.dex as `0x${string}`;
  const { data } = useReadContracts({
    contracts: [
      { abi: dexAbi, address: dexAddr, functionName: "getCurrentBatch" },
      { abi: dexAbi, address: dexAddr, functionName: "batchDuration" },
    ],
    query: { refetchInterval: 10000 },
  });
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const cur = data?.[0]?.result as any[] | undefined;
  const dur = data?.[1]?.result as bigint | undefined;
  const batchId = cur?.[0] as bigint | undefined;
  const openedAt = cur ? Number(cur[1] as bigint) : 0;
  const batchOpen = cur?.[2] as boolean | undefined;
  const orderCount = cur?.[3] as bigint | undefined;
  const remaining = openedAt && dur ? Math.max(0, openedAt + Number(dur) - now) : 0;

  const pair = dep.pairs[0];
  const pairLabel = `${pair.base.symbol} / ${pair.quote.symbol}`;

  return (
    <>
      <PageHead
        num="01 · Trade"
        title="Submit"
        em="encrypted"
        meta={<>
          BATCH {batchId !== undefined ? `#${batchId.toString()}` : "—"}<br />
          WINDOW {String(Math.floor(remaining / 60)).padStart(2, "0")}M REMAINING
        </>}
      />

      <div className="grid-2 grid-2-trade" style={{ gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 0.95fr)", alignItems: "stretch" }}>
        <OrderEntryForm />
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
