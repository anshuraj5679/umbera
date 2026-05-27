"use client";

import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { deployment } from "@/lib/dex";
import { wrapperAbi } from "@/lib/wrap";
import { OPERATOR_TTL_SECONDS } from "@/lib/operator";
import { toast } from "sonner";
import { useState } from "react";
import { Card, Pill } from "@/components/atoms";
import { txOptions, waitForTransactionSuccess } from "@/lib/gas";
import { tokenSetupRows } from "@/lib/tokenRows";

function Row({ wrapper, label }: { wrapper: `0x${string}`; label: string }) {
  const { address } = useAccount();
  const dep = deployment();
  const dex = dep.dex as `0x${string}`;
  const [busy, setBusy] = useState(false);
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { data: active, refetch } = useReadContract({
    abi: wrapperAbi, address: wrapper, functionName: "isOperator",
    args: address ? [address, dex] : undefined,
    query: { enabled: !!address },
  });

  async function onSet() {
    if (!address) return;
    setBusy(true);
    const id = toast.loading(`Approving operator · ${label}`);
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + OPERATOR_TTL_SECONDS);
      const hash = await writeContractAsync({ abi: wrapperAbi, address: wrapper, functionName: "setOperator", args: [dex, deadline], ...(await txOptions(publicClient as any, 250_000n)) });
      toast.loading("Waiting for confirmation", { id, description: hash });
      await waitForTransactionSuccess(publicClient as any, hash);
      toast.success(`Operator approved · ${label}`, { id, description: hash });
      await refetch();
    } catch (e: any) { toast.error(e?.shortMessage ?? e?.message ?? "setOperator failed", { id }); }
    finally { setBusy(false); }
  }

  return (
    <div className="op-row op-row--3">
      <span className="op-sym">{label}</span>
      <Pill kind={active ? "ok" : "muted"}>{active ? "Active" : "Not Set"}</Pill>
      <span className="op-bal" style={{ color: "var(--silver-3)", fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase" }}>
        {active ? "30-day window" : "no approval"}
      </span>
      <button disabled={busy || !address} className={"btn btn--sm " + (active ? "" : "btn--primary")} onClick={onSet}>
        {busy ? "…" : active ? "Renew (30d)" : "Approve (30d)"}
      </button>
    </div>
  );
}

export function OperatorPanel() {
  const rows = tokenSetupRows().map((row) => ({ wrapper: row.wrapper, label: row.encryptedSymbol }));
  return (
    <Card title="Operator Approvals" subtitle="Permit the matcher to settle on your behalf" meta="30-DAY WINDOWS">
      <div className="col" style={{ gap: 10 }}>
        {rows.map((r) => <Row key={r.wrapper} {...r} />)}
      </div>
    </Card>
  );
}
