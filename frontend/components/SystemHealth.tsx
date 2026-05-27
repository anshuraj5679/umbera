"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card, Cell, Empty, Pill } from "@/components/atoms";
import { shortHex } from "@/lib/format";

type HealthPayload = {
  ok: boolean;
  uptimeSec?: number;
  matcher?: {
    configuredAddress?: string;
    onChainAddress?: string | null;
    roleOk?: boolean | null;
    error?: string;
  };
  db?: { ok?: boolean; error?: string };
  indexer?: {
    latestIndexedBlock?: string | null;
    chainHeadBlock?: number | null;
    lagBlocks?: number | null;
  };
  currentBatch?: {
    id: string;
    status: string;
    onChainOrderCount?: string;
    indexedOrderCount?: string | null;
  } | null;
  closedBatchesWaitingForMatch?: Array<{
    id: string;
    closedAt: string | null;
    indexedOrderCount: string;
    onChainOrderCount: string | null;
    closeTxHash: string | null;
  }>;
  pendingMatchesPastDisputeWindow?: Array<{
    id: string;
    batchId: string;
    pairId: number;
    publishedAt: string | null;
    publishTxHash: string | null;
  }>;
  recentWorkerErrors?: Array<{
    id: string;
    component: string;
    occurredAt: string;
    payload: unknown;
  }>;
  recentTasks?: Array<{
    id: string;
    type: string;
    status: string;
    scope: string;
    batchId: string | null;
    orderId: string | null;
    matchId: string | null;
    error: string | null;
    attempts: number;
    maxAttempts: number;
    nextRunAt: string | null;
    heartbeatAt: string | null;
    createdAt: string;
    completedAt: string | null;
  }>;
  retryableTasks?: HealthPayload["recentTasks"];
  staleRunningTasks?: HealthPayload["recentTasks"];
};

export function SystemHealth() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok && !payload) throw new Error(`health failed: ${response.status}`);
      setData(payload);
      if (!response.ok) setError(payload?.error ?? payload?.db?.error ?? payload?.matcher?.error ?? "health degraded");
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const status = useMemo(() => {
    if (error) return { label: "DEGRADED", kind: "bad" as const };
    if (!data) return { label: loading ? "LOADING" : "UNKNOWN", kind: "muted" as const };
    return data.ok ? { label: "GREEN", kind: "ok" as const } : { label: "DEGRADED", kind: "bad" as const };
  }, [data, error, loading]);

  const waiting = data?.closedBatchesWaitingForMatch ?? [];
  const pending = data?.pendingMatchesPastDisputeWindow ?? [];
  const workerErrors = data?.recentWorkerErrors ?? [];
  const recentTasks = data?.recentTasks ?? [];
  const retryableTasks = data?.retryableTasks ?? [];
  const staleRunningTasks = data?.staleRunningTasks ?? [];

  return (
    <div className="col" style={{ gap: 20 }}>
      <Card
        title="Matcher Health"
        subtitle="Public HTTPS API status"
        meta={
          <div className="actions">
            <Pill kind={status.kind}>{status.label}</Pill>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void load()}
              disabled={loading}
              title="Refresh health"
              aria-label="Refresh health"
            >
              <RefreshCw size={14} aria-hidden />
            </button>
          </div>
        }
      >
        {error && (
          <div style={{ color: "var(--red)", fontFamily: "var(--mono)", fontSize: 11, marginBottom: 12 }}>
            {error}
          </div>
        )}
        <div className="grid-2" style={{ marginTop: 4 }}>
          <Cell label="Matcher Role" value={roleLabel(data)} size="lg" />
          <Cell label="Database" value={data?.db?.ok ? "ONLINE" : "OFFLINE"} muted />
          <Cell label="Indexed Block" value={data?.indexer?.latestIndexedBlock ?? "-"} encrypted />
          <Cell label="Indexer Lag" value={data?.indexer?.lagBlocks ?? "-"} muted />
          <Cell label="Current Batch" value={data?.currentBatch ? `#${data.currentBatch.id}` : "-"} />
          <Cell label="Indexed / Chain Orders" value={orderCountLabel(data)} muted />
          <Cell label="Retryable Tasks" value={retryableTasks.length} />
          <Cell label="Stale Running Tasks" value={staleRunningTasks.length} muted />
        </div>
      </Card>

      <Card title="Closed Batches" subtitle="Waiting for delayed, complete matching" meta={`${waiting.length} open`}>
        {waiting.length === 0 ? (
          <Empty>NO CLOSED BATCHES WAITING</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Closed</th>
                  <th>Indexed</th>
                  <th>On-chain</th>
                  <th style={{ textAlign: "right" }}>Tx</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((batch) => (
                  <tr key={batch.id}>
                    <td>#{batch.id}</td>
                    <td>{batch.closedAt ? formatTime(batch.closedAt) : "-"}</td>
                    <td>{batch.indexedOrderCount}</td>
                    <td>{batch.onChainOrderCount ?? "-"}</td>
                    <td style={{ textAlign: "right" }}>{txLink(batch.closeTxHash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Settlement Watch" subtitle="Pending matches past dispute window" meta={`${pending.length} stuck`}>
        {pending.length === 0 ? (
          <Empty>NO STUCK SETTLEMENTS</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Batch</th>
                  <th>Pair</th>
                  <th>Published</th>
                  <th style={{ textAlign: "right" }}>Tx</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((match) => (
                  <tr key={match.id}>
                    <td>#{match.id}</td>
                    <td>#{match.batchId}</td>
                    <td>{match.pairId}</td>
                    <td>{match.publishedAt ? formatTime(match.publishedAt) : "-"}</td>
                    <td style={{ textAlign: "right" }}>{txLink(match.publishTxHash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Task Driver" subtitle="Durable matcher workflow ledger" meta={`${recentTasks.length} recent`}>
        {(retryableTasks.length > 0 || staleRunningTasks.length > 0) && (
          <div style={{ color: "var(--amber)", fontFamily: "var(--mono)", fontSize: 11, marginBottom: 12 }}>
            {retryableTasks.length} retryable · {staleRunningTasks.length} stale running
          </div>
        )}
        {recentTasks.length === 0 ? (
          <Empty>NO RECENT TASKS</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Scope</th>
                  <th>Attempts</th>
                  <th>Reference</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {recentTasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <span style={{ color: "var(--silver-edge)", fontFamily: "var(--mono)", fontSize: 11 }}>
                        {task.type}
                      </span>
                    </td>
                    <td>{pillForTask(task.status)}</td>
                    <td>{task.scope}</td>
                    <td>{task.attempts}/{task.maxAttempts}</td>
                    <td>{taskRef(task)}</td>
                    <td>{formatTime(task.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Worker Errors" subtitle="Unresolved recent errors" meta={`${workerErrors.length} recent`}>
        {workerErrors.length === 0 ? (
          <Empty>NO RECENT WORKER ERRORS</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Time</th>
                  <th>Payload</th>
                </tr>
              </thead>
              <tbody>
                {workerErrors.map((row) => (
                  <tr key={row.id}>
                    <td>{row.component}</td>
                    <td>{formatTime(row.occurredAt)}</td>
                    <td style={{ color: "var(--silver-4)", fontFamily: "var(--mono)", fontSize: 11 }}>
                      {formatPayload(row.payload)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function pillForTask(status: string) {
  if (status === "COMPLETED") return <Pill kind="ok">{status}</Pill>;
  if (status === "FAILED" || status === "CANCELLED") return <Pill kind="bad">{status}</Pill>;
  if (status === "RUNNING") return <Pill kind="warn">{status}</Pill>;
  return <Pill kind="muted">{status}</Pill>;
}

function taskRef(task: {
  batchId: string | null;
  orderId: string | null;
  matchId: string | null;
}) {
  if (task.matchId) return `match #${task.matchId}`;
  if (task.orderId) return `order #${task.orderId}`;
  if (task.batchId) return `batch #${task.batchId}`;
  return "-";
}

function roleLabel(data: HealthPayload | null) {
  if (!data?.matcher) return "-";
  if (data.matcher.roleOk) return "OK";
  if (data.matcher.onChainAddress) {
    return `MISMATCH ${shortHex(data.matcher.onChainAddress, 4)}`;
  }
  return "UNKNOWN";
}

function orderCountLabel(data: HealthPayload | null) {
  const batch = data?.currentBatch;
  if (!batch) return "-";
  return `${batch.indexedOrderCount ?? "-"} / ${batch.onChainOrderCount ?? "-"}`;
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

function formatPayload(payload: unknown) {
  try {
    const text = JSON.stringify(payload);
    return text.length > 140 ? `${text.slice(0, 137)}...` : text;
  } catch {
    return String(payload);
  }
}
