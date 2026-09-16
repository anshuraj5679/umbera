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
  const { wallet, connectWallet } = useMidnight();

  return (
    <Card title="Balances" subtitle="Midnight Native & Confidential Token Balances" meta="LIVE">
      <div className="col" style={{ gap: 16 }}>
        {/* Midnight Native Settlement & Gas Banner */}
        <div
          style={{
            background: "linear-gradient(135deg, rgba(139, 92, 246, 0.12), rgba(30, 27, 75, 0.35))",
            border: "1px solid rgba(139, 92, 246, 0.3)",
            borderRadius: "6px",
            padding: "12px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontWeight: "600", color: "#f8fafc", fontSize: "14px" }}>tDUST (Midnight Native)</span>
              <span
                style={{
                  fontSize: "10px",
                  padding: "2px 6px",
                  background: "rgba(139, 92, 246, 0.25)",
                  color: "#c084fc",
                  borderRadius: "4px",
                  fontFamily: "var(--mono)",
                }}
              >
                Gas & ZK Settlement Token
              </span>
            </div>
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>
              {wallet.connected
                ? `Lace Connected · ${wallet.address ? wallet.address.slice(0, 14) + "..." + wallet.address.slice(-6) : "Active"} · Ready to pay ZK proof & gas fees`
                : "Connect Lace Wallet with tDUST to submit confidential trades"}
            </div>
          </div>

          <div>
            {wallet.connected ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  color: "#34d399",
                  fontSize: "12px",
                  fontFamily: "var(--mono)",
                  fontWeight: "600",
                }}
              >
                <span style={{ width: 8, height: 8, background: "#10b981", borderRadius: "50%", boxShadow: "0 0 8px #10b981" }} />
                tDUST Active
              </span>
            ) : (
              <button
                className="btn btn--primary btn--sm"
                onClick={() => connectWallet()}
                style={{ fontSize: "11px", padding: "6px 12px" }}
              >
                Connect Lace
              </button>
            )}
          </div>
        </div>

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
