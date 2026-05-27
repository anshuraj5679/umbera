"use client";

import { useAccount, usePublicClient, useWriteContract, useReadContract } from "wagmi";
import { erc20Abi } from "@/lib/faucet";
import { wrapperAbi } from "@/lib/wrap";
import { fromUnits, toUnits } from "@/lib/format";
import { toast } from "sonner";
import { useState } from "react";
import { Card } from "@/components/atoms";
import { txOptions, waitForTransactionSuccess } from "@/lib/gas";
import { tokenSetupRows, type TokenSetupRow } from "@/lib/tokenRows";

function RowEl({ row }: { row: TokenSetupRow }) {
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { data: mBal } = useReadContract({ abi: erc20Abi, address: row.underlying, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled: !!address } });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({ abi: erc20Abi, address: row.underlying, functionName: "allowance", args: address ? [address, row.wrapper] : undefined, query: { enabled: !!address } });

  async function onWrap() {
    if (!address || !amount) return;
    setBusy(true);
    const id = toast.loading(`Wrapping ${amount} ${row.symbol}`);
    try {
      const wei = toUnits(amount, row.decimals);
      if ((allowance as bigint ?? 0n) < wei) {
        const hash = await writeContractAsync({ abi: erc20Abi, address: row.underlying, functionName: "approve", args: [row.wrapper, wei], ...(await txOptions(publicClient as any, 250_000n)) });
        toast.loading("Waiting for approval confirmation", { id, description: hash });
        await waitForTransactionSuccess(publicClient as any, hash);
        await refetchAllowance();
      }
      const hash = await writeContractAsync({ abi: wrapperAbi, address: row.wrapper, functionName: "wrap", args: [wei], ...(await txOptions(publicClient as any, 2_000_000n)) });
      toast.loading("Waiting for wrap confirmation", { id, description: hash });
      await waitForTransactionSuccess(publicClient as any, hash);
      toast.success(`Wrapped ${amount} ${row.symbol}`, { id, description: hash });
      setAmount("");
    } catch (e: any) { toast.error(e?.shortMessage ?? e?.message ?? "wrap failed", { id }); }
    finally { setBusy(false); }
  }

  return (
    <div className="op-row">
      <span className="op-sym">m{row.symbol} <span className="bal-arrow">→</span> e{row.symbol}</span>
      <span className="op-bal">{mBal !== undefined ? fromUnits(mBal as bigint, row.decimals) : "—"}</span>
      <div className="input op-input">
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
        <span className="input__suffix">{row.symbol}</span>
      </div>
      <button className="btn btn--sm" disabled={busy || !address || !amount} onClick={onWrap}>
        {busy ? "…" : "Wrap"}
      </button>
    </div>
  );
}

export function WrapPanel() {
  return (
    <Card title="Wrap" subtitle="Plain → Encrypted · approve + wrap in 2 txs" meta="m → e">
      <div className="col" style={{ gap: 10 }}>
        {tokenSetupRows().map((r) => <RowEl key={r.wrapper} row={r} />)}
      </div>
    </Card>
  );
}
