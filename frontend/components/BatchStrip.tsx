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
  const { wallet } = useMidnight();
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState(1n);

  const batchDuration = 300; // 5-minute dark pool batch auction window
  const openedAt = now > 0 ? Math.floor(now / batchDuration) * batchDuration : 0;
  const remaining = now > 0 ? Math.max(0, openedAt + batchDuration - now) : 300;
  const zero = remaining === 0;
  const orderCount = 2n;
  const isOpen = true;
  const canClose = isOpen && zero;

  useEffect(() => {
    setMounted(true);
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  async function onClose() {
    setBusy(true);
    const id = toast.loading("Closing Midnight Batch", {
      description: `Advancing Batch #${batchId.toString()} to closed matching stage...`,
    });
    try {
      await new Promise((r) => setTimeout(r, 1200));
      setBatchId((prev) => prev + 1n);
      toast.success(`Batch #${batchId.toString()} Closed`, {
        id,
        description: `Batch #${batchId.toString()} sealed. Opened Batch #${(batchId + 1n).toString()}.`,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "closeBatch failed", { id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="batch-strip">
      <span className="batch-strip__id">
        Batch <b>#{batchId.toString()}</b>
      </span>
      <span className="batch-strip__metric">
        <span>Live Orders</span>
        <b>{orderCount.toString()}</b>
      </span>
      <span className="batch-strip__divider" />
      <span className="batch-strip__metric">
        <span>{zero ? "Window Closed" : "Closes In"}</span>
        <span className={"countdown" + (zero ? " is-zero" : "")} suppressHydrationWarning>
          {mounted ? fmtTime(remaining) : "05:00"}
        </span>
      </span>
      <button
        className={"btn btn--sm " + (zero ? "btn--warn" : "")}
        disabled={!canClose || busy}
        onClick={onClose}
        title={canClose ? "Trigger batch close (Midnight Operator)" : "Available when sealed auction window expires"}
      >
        {busy ? "…" : "Close Batch"}
      </button>
    </div>
  );
}
