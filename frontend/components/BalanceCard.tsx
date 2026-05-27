"use client";

import { useAccount, useReadContract } from "wagmi";
import { wrapperAbi } from "@/lib/wrap";
import { erc20Abi } from "@/lib/faucet";
import { fromUnits } from "@/lib/format";
import { useCofhe } from "@/lib/cofhe";
import { useEffect, useState } from "react";
import { Card } from "@/components/atoms";
import { tokenSetupRows } from "@/lib/tokenRows";

function Row({ underlying, wrapper, symbol, decimals }: { underlying: `0x${string}`; wrapper: `0x${string}`; symbol: string; decimals: number }) {
  const { address } = useAccount();
  const { ready, unsealUint128 } = useCofhe();
  const { data: mBal } = useReadContract({ abi: erc20Abi, address: underlying, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled: !!address } });
  const { data: eHandle } = useReadContract({ abi: wrapperAbi, address: wrapper, functionName: "encryptedBalanceOf", args: address ? [address] : undefined, query: { enabled: !!address } });
  const [plain, setPlain] = useState<bigint | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPlain(null); setErr(null);
    if (!ready || !eHandle || eHandle === 0n) return;
    (async () => {
      try { const v = await unsealUint128(eHandle as bigint); setPlain(v); }
      catch (e: any) { setErr(e?.message ?? "unseal failed"); }
    })();
  }, [ready, eHandle, unsealUint128]);

  const eState = !ready ? "dim" : err ? "err" : plain === null ? "dim" : "ok";
  const eValue = !ready ? "(connect)" : err ? "unseal failed" : plain === null ? "decrypting…" : fromUnits(plain, decimals);

  return (
    <div className="balance-row">
      <span className="bal-sym">m{symbol} <span className="bal-arrow">↔</span> e{symbol}</span>
      <span className="bal-val">{mBal !== undefined ? fromUnits(mBal as bigint, decimals) : "—"}</span>
      <span className={"bal-val " + (eState === "ok" ? "is-enc" : eState === "err" ? "is-err" : "is-dim")}>
        {eState === "dim" && plain === null && ready && !err && <i className="dotty" />}
        {eState === "err" && <span style={{ marginRight: 6 }}>ⓘ</span>}
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
