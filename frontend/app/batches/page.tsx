"use client";

import { useReadContracts } from "wagmi";
import { dexAbi, deployment } from "@/lib/dex";
import { PageHead, Card, Cell, Empty, Pill } from "@/components/atoms";
import { shortHex } from "@/lib/format";
import { useCallback, useEffect, useState } from "react";

type RecentBatch = {
  id: string;
  status: string;
  closedAt: string | null;
  indexedOrderCount: string;
  onChainOrderCount: string | null;
  matchCount: string;
  closeTxHash: string | null;
};

export default function BatchesPage() {
  const dep = deployment();
  const dexAddr = dep.dex as `0x${string}`;
  const [recent, setRecent] = useState<RecentBatch[]>([]);
  const [recentError, setRecentError] = useState<string | null>(null);
  const { data } = useReadContracts({
    contracts: [
      { abi: dexAbi, address: dexAddr, functionName: "getCurrentBatch" },
      { abi: dexAbi, address: dexAddr, functionName: "nextOrderId" },
      { abi: dexAbi, address: dexAddr, functionName: "nextMatchId" },
    ],
    query: { refetchInterval: 10000 },
  });
  const cur = data?.[0]?.result as any[] | undefined;
  const nextOrderId = data?.[1]?.result as bigint | undefined;
  const nextMatchId = data?.[2]?.result as bigint | undefined;
  const batchId = cur?.[0] as bigint | undefined;
  const orderCount = cur?.[3] as bigint | undefined;

  const loadRecent = useCallback(async () => {
    setRecentError(null);
    try {
      const response = await fetch("/api/batches/recent?limit=12", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? `request failed: ${response.status}`);
      setRecent(payload.batches ?? []);
    } catch (error) {
      setRecent([]);
      setRecentError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void loadRecent();
    const timer = window.setInterval(() => void loadRecent(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadRecent]);

  return (
    <>
      <PageHead
        num="04 · Batches"
        title="Public"
        em="ledger"
        meta={<>SEALED CLEARING · 5M WINDOWS<br />PROOF-VERIFIED</>}
      />

      <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 24 }}>
        <Cell label="Total Orders · Current Batch" value={orderCount !== undefined ? orderCount.toString() : "—"} size="lg" />
        <Cell label="Total Matches · All Time" value={nextMatchId !== undefined ? nextMatchId.toString() : "—"} muted size="lg" />
      </div>

      <Card title="Current Batch" subtitle="Sealed → matched → settled">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Status</th>
                <th>Orders</th>
                <th>Matches</th>
                <th>Volume</th>
                <th style={{ textAlign: "right" }}>Audit</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: "rgba(232,233,236,0.025)" }}>
                <td><b style={{ color: "var(--silver-edge)" }}>{batchId !== undefined ? `#${batchId.toString()}` : "—"}</b></td>
                <td><Pill kind="warn">OPEN</Pill></td>
                <td>{orderCount !== undefined ? orderCount.toString() : "—"}</td>
                <td>—</td>
                <td>—</td>
                <td style={{ textAlign: "right", color: "var(--silver-4)" }}>pending</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card title="Counters" subtitle="Across all batches">
          <div className="grid-2" style={{ marginTop: 4 }}>
            <Cell label="nextOrderId" value={nextOrderId !== undefined ? nextOrderId.toString() : "—"} size="lg" />
            <Cell label="nextMatchId" value={nextMatchId !== undefined ? nextMatchId.toString() : "—"} size="lg" muted />
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card
          title="Recent Batches"
          subtitle="Matcher-indexed history"
          meta={<button className="btn btn--ghost btn--sm" onClick={() => void loadRecent()}>Refresh</button>}
        >
          {recentError && (
            <div style={{ color: "var(--red)", fontFamily: "var(--mono)", fontSize: 11, marginBottom: 12 }}>
              {recentError}
            </div>
          )}
          {recent.length === 0 ? (
            <Empty>{recentError ? "MATCHER API UNAVAILABLE" : "NO INDEXED BATCHES"}</Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Status</th>
                    <th>Orders</th>
                    <th>Matches</th>
                    <th>Closed</th>
                    <th style={{ textAlign: "right" }}>Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((batch) => (
                    <tr key={batch.id}>
                      <td><b style={{ color: "var(--silver-edge)" }}>#{batch.id}</b></td>
                      <td>{pillForBatch(batch.status)}</td>
                      <td>{batch.indexedOrderCount} / {batch.onChainOrderCount ?? "-"}</td>
                      <td>{batch.matchCount}</td>
                      <td>{batch.closedAt ? formatTime(batch.closedAt) : "-"}</td>
                      <td style={{ textAlign: "right" }}>{txLink(batch.closeTxHash)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function pillForBatch(status: string) {
  if (status === "MATCHED" || status === "SETTLED") return <Pill kind="ok">{status}</Pill>;
  if (status === "CLOSED") return <Pill kind="warn">{status}</Pill>;
  if (status === "MATCHED_EMPTY") return <Pill kind="muted">EMPTY</Pill>;
  return <Pill>{status}</Pill>;
}

function txLink(hash: string | null) {
  if (!hash) return <span style={{ color: "var(--silver-4)" }}>-</span>;
  return (
    <a className="tx-link" href={`https://sepolia.arbiscan.io/tx/${hash}`} target="_blank" rel="noreferrer">
      {shortHex(hash, 6)}
    </a>
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
