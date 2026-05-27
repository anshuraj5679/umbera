"use client";

import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useEffect, useState } from "react";
import { dexAbi, deployment } from "@/lib/dex";
import { fetchTraderOrders, type ChainOrder, STATUS_LABEL, SIDE_LABEL } from "@/lib/orders";
import { shortHex } from "@/lib/format";
import { toast } from "sonner";
import { Card, Empty, Pill } from "@/components/atoms";
import { txOptions, waitForTransactionSuccess } from "@/lib/gas";

function pillFor(s: number) {
  const label = STATUS_LABEL[s] ?? String(s);
  if (s === 0) return <Pill kind="ok">{label}</Pill>;
  if (s === 1) return <Pill kind="warn">{label}</Pill>;
  if (s === 2) return <Pill kind="ok">{label}</Pill>;
  if (s === 3) return <Pill kind="muted">{label}</Pill>;
  return <Pill>{label}</Pill>;
}

export function MyOrdersTable() {
  const { address } = useAccount();
  const client = usePublicClient();
  const dep = deployment();
  const [rows, setRows] = useState<ChainOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { writeContractAsync } = useWriteContract();

  async function load() {
    if (!address || !client) return;
    setLoading(true); setErr(null);
    try { setRows(await fetchTraderOrders(client as any, address)); }
    catch (e: any) { setErr(e?.message ?? "load failed"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [address, client]);

  useEffect(() => {
    const onRefresh = () => { void load(); };
    window.addEventListener("orders:refresh", onRefresh);
    return () => window.removeEventListener("orders:refresh", onRefresh);
  }, [address, client]);

  async function action(name: "cancelOrder" | "withdrawRemainder", orderId: bigint) {
    const id = toast.loading(name === "cancelOrder" ? "Cancelling order" : "Withdrawing remainder");
    try {
      const hash = await writeContractAsync({ abi: dexAbi, address: dep.dex as `0x${string}`, functionName: name, args: [orderId], ...(await txOptions(client as any, 2_000_000n)) });
      toast.loading("Waiting for confirmation", { id, description: hash });
      await waitForTransactionSuccess(client as any, hash);
      toast.success(name === "cancelOrder" ? "Order cancelled" : "Remainder withdrawn", { id, description: hash });
      await load();
    } catch (e: any) { toast.error(e?.shortMessage ?? e?.message ?? `${name} failed`, { id }); }
  }

  if (!address) {
    return (
      <Card title="My Orders" subtitle="Your encrypted submissions across all batches">
        <Empty>Connect wallet to view your orders</Empty>
      </Card>
    );
  }

  return (
    <Card
      title={loading ? "Loading…" : `${rows.length} Order${rows.length === 1 ? "" : "s"}`}
      subtitle="Your encrypted submissions across all batches"
      meta={<button className="btn btn--ghost btn--sm" onClick={load}>Refresh</button>}
    >
      {err && <div style={{ color: "var(--red)", fontFamily: "var(--mono)", fontSize: 11, marginBottom: 12 }}>{err}</div>}
      {rows.length === 0 ? (
        <Empty>No orders yet — head to Trade to submit your first</Empty>
      ) : (
        <div className="table-wrap" style={{ marginTop: 4 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Pair</th>
                <th>Side</th>
                <th>Batch</th>
                <th>Status</th>
                <th>Tx</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const pair = dep.pairs[Number(o.pairId)];
                const pairLabel = pair ? `${pair.base.symbol}/${pair.quote.symbol}` : `#${o.pairId}`;
                return (
                  <tr key={o.orderId.toString()}>
                    <td style={{ color: "var(--silver-4)" }}>{o.orderId.toString()}</td>
                    <td>{pairLabel}</td>
                    <td>
                      <span style={{
                        color: "var(--silver-3)",
                        letterSpacing: ".24em",
                        fontSize: 11,
                        textTransform: "uppercase",
                      }}>{SIDE_LABEL[o.side]}</span>
                    </td>
                    <td>#{o.batchId.toString()}</td>
                    <td>{pillFor(o.status)}</td>
                    <td>
                      <a className="tx-link" href={`https://sepolia.arbiscan.io/tx/${o.txHash}`} target="_blank" rel="noreferrer">
                        {shortHex(o.txHash, 6)}
                      </a>
                    </td>
                    <td className="actions" style={{ justifyContent: "flex-end" }}>
                      {o.status === 0 && (
                        <button className="btn btn--sm btn--danger" onClick={() => action("cancelOrder", o.orderId)}>Cancel</button>
                      )}
                      {(o.status === 1 || o.status === 2) && (
                        <button className="btn btn--sm btn--warn" onClick={() => action("withdrawRemainder", o.orderId)}>Withdraw</button>
                      )}
                      {o.status === 3 && (
                        <span style={{ color: "var(--silver-4)", fontSize: 10, letterSpacing: ".22em", textTransform: "uppercase" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
