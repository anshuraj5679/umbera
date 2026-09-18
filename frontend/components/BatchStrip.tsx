"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useMidnight } from "@/midnight";

function fmtTime(s: number) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function BatchStrip() {
  const { batchId, batchOpen, remainingSeconds, orderCount, closeBatch } = useMidnight();
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);

  const zero = remainingSeconds === 0;
  const canClose = zero || true; // Can seal auction window on demand or when expired

  useEffect(() => {
    setMounted(true);
  }, []);

  async function onClose() {
    setBusy(true);
    const id = toast.loading("Closing Midnight Batch", {
      description: `Advancing Batch #${batchId.toString()} to settlement stage...`,
    });
    try {
      await new Promise((r) => setTimeout(r, 600));
      await closeBatch();
      toast.dismiss(id);
    } catch (e: any) {
      toast.error(e?.message ?? "closeBatch failed", { id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="batch-strip">
      <span className="batch-strip__id">
        Batch <b>#{mounted ? batchId.toString() : "1"}</b>
      </span>
      <span className="batch-strip__metric">
        <span>Live Orders</span>
        <b>{mounted ? orderCount.toString() : "2"}</b>
      </span>
      <span className="batch-strip__divider" />
      <span className="batch-strip__metric">
        <span>{zero ? "Window Closed" : "Closes In"}</span>
        <span className={"countdown" + (zero ? " is-zero" : "")} suppressHydrationWarning>
          {mounted ? fmtTime(remainingSeconds) : "05:00"}
        </span>
      </span>
      <button
        className={"btn btn--sm " + (zero ? "btn--warn" : "")}
        disabled={busy}
        onClick={onClose}
        title={zero ? "Auction window closed. Click to advance to next batch." : "Trigger batch close & advance to next sealed window (Operator)"}
      >
        {busy ? "…" : "Close Batch"}
      </button>
    </div>
  );
}
