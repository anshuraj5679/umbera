"use client";

import { useAccount, useReadContract } from "wagmi";
import { wrapperAbi } from "@/lib/wrap";
import { erc20Abi } from "@/lib/faucet";
import { fromUnits } from "@/lib/format";
import { useMidnight } from "@/midnight";
import { useEffect, useState } from "react";
import { Card } from "@/components/atoms";
import { tokenSetupRows } from "@/lib/tokenRows";

function Row({ underlying, wrapper, symbol, decimals }: { underlying: `0x${string}`; wrapper: `0x${string}`; symbol: string; decimals: number }) {
  const { address } = useAccount();
  const { wallet } = useMidnight();
  const { data: mBal } = useReadContract({ abi: erc20Abi, address: underlying, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled: !!address } });
  const { data: eHandle } = useReadContract({ abi: wrapperAbi, address: wrapper, functionName: "encryptedBalanceOf", args: address ? [address] : undefined, query: { enabled: !!address } });
  const [plain, setPlain] = useState<bigint | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const eState = !wallet.connected ? "dim" : "ok";
  const eValue = wallet.connected ? "Private State Active" : "(connect Lace)";

  return (
    <div className="balance-row">
      <span className="bal-sym">m{symbol} <span className="bal-arrow">↔</span> e{symbol}</span>
      <span className="bal-val">{mBal !== undefined ? fromUnits(mBal as bigint, decimals) : "—"}</span>
      <span className={"bal-val " + (eState === "ok" ? "is-enc" : "is-dim")}>
        {eValue}
      </span>
    </div>
  );
}

export function BalanceCard() {
  const rows = tokenSetupRows();
  return (
    <Card title="Balances" subtitle="Plain ↔ Encrypted token pairs" meta="LIVE">
      <div className="col" style={{ gap: 10 }}>
        <div className="balance-row balance-row--head">
          <span>Token</span>
          <span>m·Plain</span>
          <span>e·Decrypted</span>
        </div>
        {rows.map((r) => <Row key={r.wrapper} {...r} />)}
      </div>
    </Card>
  );
}
