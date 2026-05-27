"use client";

import { usePublicClient, useReadContracts } from "wagmi";
import { dexAbi, deployment } from "@/lib/dex";
import { PageHead, Card, Cell, Empty, Pill } from "@/components/atoms";
import { shortHex } from "@/lib/format";
import { fetchClosedBatchesAwaitingMatching } from "@/lib/matcher-actions";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function OperatorHome() {
  const dep = deployment();
  const dexAddr = dep.dex as `0x${string}`;
  const client = usePublicClient();
  const { data } = useReadContracts({
    contracts: [
      { abi: dexAbi, address: dexAddr, functionName: "getCurrentBatch" },
      { abi: dexAbi, address: dexAddr, functionName: "nextOrderId" },
      { abi: dexAbi, address: dexAddr, functionName: "nextMatchId" },
      { abi: dexAbi, address: dexAddr, functionName: "matcher" },
    ],
    query: { refetchInterval: 10000 },
  });
  const cur = data?.[0]?.result as any[] | undefined;
  const nextOrderId = data?.[1]?.result as bigint | undefined;
  const nextMatchId = data?.[2]?.result as bigint | undefined;
  const matcherAddr = data?.[3]?.result as string | undefined;
  const orderCount = cur?.[3] as bigint | undefined;
  const currentBatch = cur?.[0] as bigint | undefined;

  const [closed, setClosed] = useState<bigint[]>([]);
  useEffect(() => {
    if (!client) return;
    fetchClosedBatchesAwaitingMatching(client as any).then(setClosed).catch(() => {});
  }, [client, currentBatch]);

  return (
    <>
      <PageHead
        num="05 · Operator"
        title="Matcher"
        em="console"
        meta={<>ROLE · MATCHER<br />{matcherAddr ? shortHex(matcherAddr, 4) : "—"}</>}
      />

      <div className="grid-4" style={{ marginBottom: 24 }}>
        <Cell label="Current Batch Orders" value={orderCount !== undefined ? orderCount.toString() : "—"} size="lg" />
        <Cell label="Total Orders" value={nextOrderId !== undefined ? nextOrderId.toString() : "—"} size="lg" />
        <Cell label="Total Matches" value={nextMatchId !== undefined ? nextMatchId.toString() : "—"} size="lg" muted />
        <Cell label="Closed Batches" value={closed.length.toString()} size="lg" encrypted />
      </div>

      <Card title="Closed Batches" subtitle="Run auction → publish matches" meta="OPERATOR QUEUE">
        {closed.length === 0 ? (
          <Empty>No closed batches yet — close the current batch from the Trade page when its timer hits 0.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((b) => (
                  <tr key={b.toString()}>
                    <td><b style={{ color: "var(--silver-edge)" }}>#{b.toString()}</b></td>
                    <td><Pill kind="warn">AWAITING MATCH</Pill></td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/operator/batch/${b.toString()}`} className="btn btn--sm btn--primary">Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
