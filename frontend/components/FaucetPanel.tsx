"use client";

import { useAccount, usePublicClient, useWriteContract, useReadContract } from "wagmi";
import { erc20Abi } from "@/lib/faucet";
import { fromUnits, toUnits } from "@/lib/format";
import { toast } from "sonner";
import { useState } from "react";
import { Card } from "@/components/atoms";
import { txOptions, waitForTransactionSuccess } from "@/lib/gas";
import { tokenSetupRows, type TokenSetupRow } from "@/lib/tokenRows";

const DEFAULT_MINT: Record<string, string> = {
  USDC: "10000",
  WETH: "10",
  WBTC: "1",
  ARB: "5000",
  LINK: "2000",
};

function Row({ row }: { row: TokenSetupRow }) {
  const { address } = useAccount();
  const tokenAddr = row.underlying;
  const defaultMint = DEFAULT_MINT[row.symbol] ?? "1000";
  const [amount, setAmount] = useState(defaultMint);
  const [busy, setBusy] = useState(false);
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { data: bal, refetch } = useReadContract({
    abi: erc20Abi, address: tokenAddr, functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  async function onMint() {
    if (!address) return;
    setBusy(true);
    const id = toast.loading(`Minting ${row.underlyingSymbol}`);
    try {
      const wei = toUnits(amount, row.decimals);
      const hash = await writeContractAsync({ abi: erc20Abi, address: tokenAddr, functionName: "mint", args: [address, wei], ...(await txOptions(publicClient as any, 250_000n)) });
      toast.loading("Waiting for confirmation", { id, description: hash });
      await waitForTransactionSuccess(publicClient as any, hash);
      toast.success(`Minted ${row.underlyingSymbol}`, { id, description: hash });
      await refetch();
    } catch (e: any) { toast.error(e?.shortMessage ?? e?.message ?? "mint failed", { id }); }
    finally { setBusy(false); }
  }

  return (
    <div className="op-row">
      <span className="op-sym">{row.underlyingSymbol}</span>
      <span className="op-bal">{bal !== undefined ? fromUnits(bal as bigint, row.decimals) : "—"}</span>
      <div className="input op-input">
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <span className="input__suffix">{row.symbol}</span>
      </div>
      <button className="btn btn--primary btn--sm" disabled={busy || !address} onClick={onMint}>
        {busy ? "…" : "Mint"}
      </button>
    </div>
  );
}

export function FaucetPanel() {
  return (
    <Card title="Faucet" subtitle="Mint test tokens" meta="TESTNET · ARBITRUM SEPOLIA">
      <div className="col" style={{ gap: 10 }}>
        {tokenSetupRows().map((row) => <Row key={row.wrapper} row={row} />)}
      </div>
    </Card>
  );
}
