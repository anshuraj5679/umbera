"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { usePublicClient, useWriteContract } from "wagmi";
import { dexAbi, deployment } from "@/lib/dex";
import { fetchOrdersInBatch, type BatchOrder } from "@/lib/matcher-actions";
import { useCofhe } from "@/lib/cofhe";
import { runAuction } from "@/lib/auction/auction";
import type { DecryptedOrder, AuctionMatch } from "@/lib/auction/types";
import { PageHead, Card, Pill, Empty } from "@/components/atoms";
import { fromUnits, shortHex } from "@/lib/format";
import { toast } from "sonner";
import { txOptions, waitForTransactionSuccess } from "@/lib/gas";

type Decrypted = BatchOrder & {
  side: "BUY" | "SELL" | "UNKNOWN";
  dep: bigint;
  req: bigint;
  baseDeposit: bigint;
  quoteDeposit: bigint;
  baseRequest: bigint;
  quoteRequest: bigint;
  err?: string;
};

function classifySide(baseDeposit: bigint, quoteDeposit: bigint, baseRequest: bigint, quoteRequest: bigint): Decrypted["side"] {
  if (baseDeposit > 0n && quoteRequest > 0n && quoteDeposit === 0n && baseRequest === 0n) return "BUY";
  if (quoteDeposit > 0n && baseRequest > 0n && baseDeposit === 0n && quoteRequest === 0n) return "SELL";
  return "UNKNOWN";
}

function privateMatchFlow(m: AuctionMatch) {
  if (m.buyOrderId < m.sellOrderId) {
    return {
      orderAId: m.buyOrderId,
      orderBId: m.sellOrderId,
      baseToA: 0n,
      quoteToA: m.assetAmount,
      baseToB: m.cashAmount,
      quoteToB: 0n,
    };
  }
  return {
    orderAId: m.sellOrderId,
    orderBId: m.buyOrderId,
    baseToA: m.cashAmount,
    quoteToA: 0n,
    baseToB: 0n,
    quoteToB: m.assetAmount,
  };
}

export default function BatchDetail() {
  const params = useParams();
  const batchId = BigInt((params?.id as string) ?? "0");
  const client = usePublicClient();
  const dep = deployment();
  const { ready, error: cofheError, unsealUint128, encrypt128 } = useCofhe();
  const { writeContractAsync } = useWriteContract();

  const [orders, setOrders] = useState<Decrypted[]>([]);
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<AuctionMatch[]>([]);
  const [clearing, setClearing] = useState<bigint>(0n);
  const [publishing, setPublishing] = useState(false);

  async function loadAndDecrypt() {
    if (!client) return;
    setLoading(true);
    try {
      const raw = await fetchOrdersInBatch(client as any, batchId);
      const active = raw.filter((o) => o.status === 0); // ACTIVE only
      if (!ready) {
        setOrders(active.map((o) => ({ ...o, side: "UNKNOWN", dep: 0n, req: 0n, baseDeposit: 0n, quoteDeposit: 0n, baseRequest: 0n, quoteRequest: 0n, err: "cofhe not ready" })));
        return;
      }
      const decrypted: Decrypted[] = [];
      for (const o of active) {
        try {
          const [baseDeposit, quoteDeposit, baseRequest, quoteRequest] = await Promise.all([
            unsealUint128(o.baseDepositHandle),
            unsealUint128(o.quoteDepositHandle),
            unsealUint128(o.baseRequestHandle),
            unsealUint128(o.quoteRequestHandle),
          ]);
          const side = classifySide(baseDeposit, quoteDeposit, baseRequest, quoteRequest);
          decrypted.push({
            ...o,
            side,
            dep: side === "BUY" ? baseDeposit : side === "SELL" ? quoteDeposit : 0n,
            req: side === "BUY" ? quoteRequest : side === "SELL" ? baseRequest : 0n,
            baseDeposit,
            quoteDeposit,
            baseRequest,
            quoteRequest,
          });
        } catch (e: any) {
          decrypted.push({ ...o, side: "UNKNOWN", dep: 0n, req: 0n, baseDeposit: 0n, quoteDeposit: 0n, baseRequest: 0n, quoteRequest: 0n, err: e?.message ?? "unseal failed" });
        }
      }
      setOrders(decrypted);
    } catch (e: any) {
      toast.error(e?.message ?? "load failed");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    setOrders([]); setMatches([]); setClearing(0n);
    if (ready) loadAndDecrypt();
  }, [batchId, ready]);

  function runPreview() {
    // group by pair, run auction per pair
    const allMatches: AuctionMatch[] = [];
    let clearingForFirst = 0n;
    for (const p of dep.pairs) {
      const pairOrders = orders.filter((o) => o.pairId === p.id && !o.err && o.side !== "UNKNOWN");
      const dorders: DecryptedOrder[] = pairOrders.map((o) => ({
        id: o.orderId,
        side: o.side === "BUY" ? "BUY" : "SELL",
        remainingDeposit: o.dep,
        remainingRequest: o.req,
        cashDecimals: p.base.decimals,
        assetDecimals: p.quote.decimals,
      }));
      const res = runAuction(dorders);
      allMatches.push(...res.matches);
      if (clearingForFirst === 0n && res.clearingPriceQuotePerBase > 0n) clearingForFirst = res.clearingPriceQuotePerBase;
    }
    setMatches(allMatches);
    setClearing(clearingForFirst);
    if (allMatches.length === 0) toast.info("No crossing orders — auction empty");
  }

  async function publish() {
    if (matches.length === 0) return;
    setPublishing(true);
    const id = toast.loading("Encrypting match transfers…");
    try {
      const orderAs: bigint[] = [], orderBs: bigint[] = [], baseToAs: any[] = [], quoteToAs: any[] = [], baseToBs: any[] = [], quoteToBs: any[] = [];
      for (const m of matches) {
        const flow = privateMatchFlow(m);
        orderAs.push(flow.orderAId);
        orderBs.push(flow.orderBId);
        const enc = await encrypt128([flow.baseToA, flow.quoteToA, flow.baseToB, flow.quoteToB]);
        baseToAs.push(enc![0]);
        quoteToAs.push(enc![1]);
        baseToBs.push(enc![2]);
        quoteToBs.push(enc![3]);
      }
      toast.loading("Publishing matches on-chain…", { id });
      const hash = await writeContractAsync({
        abi: dexAbi,
        address: dep.dex as `0x${string}`,
        functionName: "publishMatches",
        args: [orderAs, orderBs, baseToAs, quoteToAs, baseToBs, quoteToBs],
        ...(await txOptions(client as any, 12_000_000n)),
      });
      toast.loading("Waiting for confirmation", { id, description: hash });
      await waitForTransactionSuccess(client as any, hash);
      toast.success("Matches published", { id, description: hash });
      await loadAndDecrypt();
    } catch (e: any) {
      toast.error(e?.shortMessage ?? e?.message ?? "publish failed", { id });
    } finally { setPublishing(false); }
  }

  return (
    <>
      <PageHead
        num={`05 · Batch #${batchId.toString()}`}
        title="Run"
        em="auction"
        meta={<>OPERATOR<br />{orders.length} ORDERS</>}
      />

      <Card
        title={`Orders in Batch #${batchId.toString()}`}
        subtitle="Decrypted with your matcher permit"
        meta={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn--ghost btn--sm" disabled={loading || !ready} onClick={loadAndDecrypt}>
              {loading ? "…" : "Reload"}
            </button>
            <button className="btn btn--sm" disabled={!orders.length || loading} onClick={runPreview}>
              Run Auction
            </button>
          </div>
        }
      >
        {!ready ? (
          <Empty>Initializing CoFHE permit…</Empty>
        ) : orders.length === 0 ? (
          <Empty>{loading ? "Loading…" : "No active orders in this batch"}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Pair</th>
                  <th>Side</th>
                  <th>Deposit</th>
                  <th>Request</th>
                  <th>Trader</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const p = dep.pairs[o.pairId];
                  return (
                    <tr key={o.orderId.toString()}>
                      <td style={{ color: "var(--silver-4)" }}>{o.orderId.toString()}</td>
                      <td>{p ? `${p.base.symbol}/${p.quote.symbol}` : `#${o.pairId}`}</td>
                      <td>
                        <span style={{ color: o.side === "BUY" ? "var(--emerald)" : o.side === "SELL" ? "var(--red)" : "var(--silver-3)", letterSpacing: ".24em", fontSize: 11, textTransform: "uppercase" }}>
                          {o.side}
                        </span>
                      </td>
                      <td>{o.err ? <span style={{ color: "var(--red)" }}>ⓘ {o.err}</span> : fromUnits(o.dep, o.side === "BUY" ? (p?.base.decimals ?? 18) : (p?.quote.decimals ?? 18))}</td>
                      <td>{o.err ? "—" : fromUnits(o.req, o.side === "BUY" ? (p?.quote.decimals ?? 18) : (p?.base.decimals ?? 18))}</td>
                      <td style={{ color: "var(--silver-3)", fontSize: 11 }}>{shortHex(o.trader, 4)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {matches.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <Card
            title="Auction Preview"
            subtitle={`Midpoint clearing · price ≈ ${clearing.toString()} quote/base`}
            meta={
              <button className="btn btn--primary btn--sm" disabled={publishing} onClick={publish}>
                {publishing ? "Publishing…" : "Publish Matches"}
              </button>
            }
          >
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Buy</th>
                    <th>Sell</th>
                    <th>Base Cash</th>
                    <th>Quote Asset</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m, i) => (
                    <tr key={i}>
                      <td style={{ color: "var(--silver-4)" }}>{i + 1}</td>
                      <td>#{m.buyOrderId.toString()}</td>
                      <td>#{m.sellOrderId.toString()}</td>
                      <td>{m.cashAmount.toString()}</td>
                      <td>{m.assetAmount.toString()}</td>
                      <td><Pill kind="warn">PREVIEW</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
