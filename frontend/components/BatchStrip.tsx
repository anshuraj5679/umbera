"use client";

import { usePublicClient, useReadContracts, useWriteContract } from "wagmi";
import { dexAbi, deployment } from "@/lib/dex";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { txOptions, waitForTransactionSuccess } from "@/lib/gas";

function fmtTime(s: number) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function BatchStrip() {
  const dep = deployment();
  const dexAddr = dep.dex as `0x${string}`;
  const { data, refetch } = useReadContracts({
    contracts: [
      { abi: dexAbi, address: dexAddr, functionName: "getCurrentBatch" },
      { abi: dexAbi, address: dexAddr, functionName: "batchDuration" },
    ],
    query: { refetchInterval: 10000 },
  });
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const cur = data?.[0]?.result as any[] | undefined;
  const dur = data?.[1]?.result as bigint | undefined;
  if (!cur || dur === undefined) {
    return (
      <div className="batch-strip">
        <span className="batch-strip__id">Batch <b>—</b></span>
        <span className="batch-strip__metric"><span>Loading</span></span>
        <span className="batch-strip__divider" />
        <span className="batch-strip__metric"><span>—</span></span>
        <span className="countdown">--:--</span>
        <button className="btn btn--sm" disabled>Close Batch</button>
      </div>
    );
  }

  const batchId = cur[0] as bigint;
  const openedAt = Number(cur[1] as bigint);
  const isOpen = cur[2] as boolean;
  const orderCount = cur[3] as bigint;
  const remaining = Math.max(0, openedAt + Number(dur) - now);
  const zero = remaining === 0;
  const canClose = isOpen && zero;

  async function onClose() {
    setBusy(true);
    const id = toast.loading("Closing batch");
    try {
      const hash = await writeContractAsync({ abi: dexAbi, address: dexAddr, functionName: "closeBatch", args: [], ...(await txOptions(publicClient as any, 300_000n)) });
      toast.loading("Waiting for confirmation", { id, description: hash });
      await waitForTransactionSuccess(publicClient as any, hash);
      toast.success("Batch closed", { id, description: hash });
      await refetch();
    } catch (e: any) {
      toast.error(e?.shortMessage ?? e?.message ?? "closeBatch failed", { id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="batch-strip">
      <span className="batch-strip__id">Batch <b>#{batchId.toString()}</b></span>
      <span className="batch-strip__metric">
        <span>Live Orders</span><b>{orderCount.toString()}</b>
      </span>
      <span className="batch-strip__divider" />
      <span className="batch-strip__metric">
        <span>{zero ? "Window Closed" : "Closes In"}</span>
        <span className={"countdown" + (zero ? " is-zero" : "")}>{fmtTime(remaining)}</span>
      </span>
      <button
        className={"btn btn--sm " + (zero ? "btn--warn" : "")}
        disabled={!canClose || busy}
        onClick={onClose}
        title={canClose ? "Trigger batch close" : "Available when window expires"}
      >
        {busy ? "…" : "Close Batch"}
      </button>
    </div>
  );
}
