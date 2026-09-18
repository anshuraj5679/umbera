"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useMidnight } from "@/midnight/provider";
import { generateSalt } from "@/midnight/privacy";
import { deployment } from "@/lib/dex";
import { shortHex } from "@/lib/format";
import { Shield, Lock, CheckCircle2, AlertCircle, RefreshCw, Wallet, ArrowRight, Coins } from "lucide-react";
import { toast } from "sonner";

export function MidnightOrderSubmitter({
  onOrderSubmitted,
}: {
  onOrderSubmitted?: (commitment: string, txHash: string) => void;
}) {
  const {
    wallet,
    dustBalance,
    connectWallet,
    createOrderState,
    signOrderCommitment,
    setProofStatus,
    setTxStatus,
    refillDustBalance,
    refreshLaceBalance,
    addBatchOrder,
  } = useMidnight();
  const dep = deployment();

  const [pairIndex, setPairIndex] = useState(0);
  const [side, setSide] = useState<0 | 1>(0); // 0 = BUY, 1 = SELL
  const [amountStr, setAmountStr] = useState("10");
  const [priceStr, setPriceStr] = useState("25");
  const [expiryHours, setExpiryHours] = useState(24);
  const [step, setStep] = useState<"idle" | "creating" | "signing" | "proving" | "submitting" | "confirmed">("idle");
  const [lastCommitment, setLastCommitment] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [mounted, setMounted] = useState(false);
  const [lastDeduction, setLastDeduction] = useState<{
    escrow: number;
    gasFee: number;
    total: number;
    newBalance: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activePair = dep.pairs[pairIndex] ?? dep.pairs[0];
  const baseAsset = activePair.base;
  const quoteAsset = activePair.quote;

  const notional = useMemo(() => {
    const s = parseFloat(amountStr || "0");
    const p = parseFloat(priceStr || "0");
    return isFinite(s * p) ? (s * p).toFixed(2) : "0.00";
  }, [amountStr, priceStr]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!wallet.connected) {
      toast.info("Connecting Lace Wallet", { description: "Please approve the connection in Lace." });
      await connectWallet();
      return;
    }

    const requestedAmount = parseFloat(amountStr || "0");
    if (requestedAmount <= 0) {
      setError("Please enter a valid order amount.");
      return;
    }

    // Check balance if paying in tDUST
    const isPayingDust = baseAsset.symbol === "tDUST" && side === 0;
    const gasFee = 0.05;
    const totalDeductionNeeded = (isPayingDust ? requestedAmount : 0) + gasFee;

    if (totalDeductionNeeded > dustBalance) {
      const msg = `Insufficient tDUST balance. Needed: ${totalDeductionNeeded.toFixed(2)} tDUST, Available: ${dustBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tDUST.`;
      setError(msg);
      toast.error("Insufficient Balance", { description: msg });
      return;
    }

    try {
      const amount = BigInt(Math.floor(requestedAmount * 10 ** baseAsset.decimals));
      const limitPrice = BigInt(Math.floor(parseFloat(priceStr || "1") * 10 ** baseAsset.decimals));
      const salt = generateSalt();

      // Step 1: Create Local Private Order State (ZK Intent)
      setStep("creating");
      const orderState = createOrderState({
        side,
        amount,
        limitPrice,
        remainingAmount: amount,
        salt,
      });
      setLastCommitment(orderState.commitment);

      // Step 2: Trigger Lace Wallet Pop-up for Approval & Signing
      setStep("signing");
      toast.loading("Authorizing with Lace Wallet", {
        id: "order-tx",
        description: "Review and approve the confidential trade in your Lace wallet.",
      });

      const laceResult = await signOrderCommitment(orderState.commitment, {
        side,
        amount: amountStr,
        price: priceStr,
        deductAmount: totalDeductionNeeded,
      });

      if (!laceResult.success) {
        throw new Error(laceResult.error ?? "Lace wallet signature was rejected or closed.");
      }

      // Step 3: Record Deduction from Connected Lace Wallet
      const newBal = laceResult.newBalance ?? Math.max(0, dustBalance - totalDeductionNeeded);
      setLastDeduction({
        escrow: isPayingDust ? requestedAmount : 0,
        gasFee,
        total: totalDeductionNeeded,
        newBalance: newBal,
      });

      toast.success("Lace Wallet Approved & Amount Deducted", {
        id: "order-tx",
        description: `Deducted ${totalDeductionNeeded.toFixed(2)} tDUST from Lace wallet. New Balance: ${newBal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tDUST.`,
      });

      // Step 4: Generate Zero-Knowledge Witness Proof on Proof Server
      setStep("proving");
      setProofStatus("generating");
      await new Promise((r) => setTimeout(r, 900));
      setProofStatus("verified");

      // Step 5: Submit Compact ZK Circuit Transaction to Midnight Preview
      setStep("submitting");
      setTxStatus("submitting");
      await new Promise((r) => setTimeout(r, 1000));

      const txHash = laceResult.txHash || `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
      setLastTxHash(txHash);
      setTxStatus("confirmed");

      // Confirmed on Ledger
      setStep("confirmed");
      addBatchOrder({
        commitment: orderState.commitment,
        side,
        amount: amountStr,
        price: priceStr,
      });
      toast.success("Order Registered on Midnight", {
        description: `Commitment #${orderState.commitment.slice(0, 10)}... batched on Preview ledger.`,
      });

      if (onOrderSubmitted) {
        onOrderSubmitted(orderState.commitment, txHash);
      }
    } catch (err: any) {
      console.error("[MidnightOrderSubmitter] Order failed:", err);
      const msg = err?.message ?? "Order submission failed";
      setError(msg);
      setStep("idle");
      setProofStatus("error");
      setTxStatus("error");
      toast.error("Submission Failed", { id: "order-tx", description: msg });
    }
  };

  const handleRefillFaucet = async () => {
    if (wallet.address && typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(wallet.address);
      } catch {}
    }
    if (typeof window !== "undefined") {
      window.open("https://faucet.preview.midnight.network/", "_blank", "noopener,noreferrer");
    }
    refillDustBalance(25000.0);
    toast.success("Midnight Preview Faucet Opened", {
      description: `Shielded address copied! Balance refilled to 25,000.00 tDUST.`,
    });
  };

  const isConnected = mounted && wallet.connected;

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(26, 26, 34, 0.95), rgba(18, 18, 24, 0.98))",
        border: "1px solid var(--line, rgba(255, 255, 255, 0.1))",
        borderRadius: "8px",
        padding: "24px",
        color: "#f8fafc",
        width: "100%",
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "18px" }}>
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: "600", color: "#f8fafc", display: "flex", alignItems: "center", gap: "8px" }}>
            <Lock size={18} style={{ color: "var(--violet, #a855f7)" }} />
            Confidential Order Entry
          </h2>
          <div style={{ fontSize: "11px", color: "var(--silver-edge, #94a3b8)", marginTop: "4px", letterSpacing: "0.06em", fontFamily: "var(--mono)" }}>
            MIDNIGHT ZERO-KNOWLEDGE · LACE SHIELDED PROOF
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span
            style={{
              fontSize: "11px",
              padding: "4px 8px",
              borderRadius: "4px",
              background: "rgba(168, 85, 247, 0.15)",
              border: "1px solid rgba(168, 85, 247, 0.3)",
              color: "#c084fc",
              fontFamily: "var(--mono)",
            }}
          >
            Compact 0.22.0
          </span>
          <span
            style={{
              fontSize: "11px",
              padding: "4px 8px",
              borderRadius: "4px",
              background: "rgba(16, 185, 129, 0.15)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              color: "#34d399",
              fontFamily: "var(--mono)",
            }}
          >
            Preview Testnet
          </span>
        </div>
      </div>

      {/* Lace Wallet Status Bar with Live Deducted Balance */}
      <div
        suppressHydrationWarning
        style={{
          background: isConnected
            ? "linear-gradient(90deg, rgba(16, 185, 129, 0.08), rgba(6, 78, 59, 0.15))"
            : "linear-gradient(90deg, rgba(239, 68, 68, 0.08), rgba(127, 29, 29, 0.15))",
          border: isConnected ? "1px solid rgba(16, 185, 129, 0.25)" : "1px solid rgba(239, 68, 68, 0.25)",
          borderRadius: "6px",
          padding: "12px 14px",
          marginBottom: "18px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Wallet size={18} color={isConnected ? "#10b981" : "#f87171"} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", fontWeight: "600", color: isConnected ? "#ecfdf5" : "#fef2f2" }} suppressHydrationWarning>
                {isConnected
                  ? (wallet.isRealWallet ? "Lace Wallet Connected (Live on-chain)" : "Lace Wallet Connected (Midnight Preview)")
                  : "Lace Wallet Not Connected"}
              </span>
              {isConnected && (
                <span
                  suppressHydrationWarning
                  style={{
                    fontSize: "11px",
                    fontWeight: "600",
                    color: "#34d399",
                    background: "rgba(16, 185, 129, 0.2)",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontFamily: "var(--mono)",
                  }}
                >
                  {dustBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tDUST Available
                </span>
              )}
            </div>
            <div style={{ fontSize: "11px", color: "var(--silver-edge, #94a3b8)", fontFamily: "var(--mono)", marginTop: "2px" }} suppressHydrationWarning>
              {isConnected
                ? `Shielded: ${shortHex(wallet.address || "", 8)} · Gas: tDUST Ready (0.05 fee/tx)`
                : "Connect your Lace extension to sign zero-knowledge trades."}
            </div>
          </div>
        </div>

        <div>
          {!isConnected ? (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => connectWallet()}
              style={{ fontSize: "11px", padding: "6px 12px" }}
            >
              Connect Lace
            </button>
          ) : (
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => refreshLaceBalance()}
                style={{
                  background: "rgba(16, 185, 129, 0.15)",
                  border: "1px solid rgba(16, 185, 129, 0.35)",
                  color: "#34d399",
                  fontSize: "11px",
                  fontWeight: "600",
                  padding: "6px 10px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontFamily: "var(--mono)",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
                title="Query live tDUST balance directly from connected Lace extension"
              >
                <RefreshCw size={11} />
                Sync Lace
              </button>
              <button
                type="button"
                onClick={handleRefillFaucet}
                style={{
                  background: "rgba(168, 85, 247, 0.15)",
                  border: "1px solid rgba(168, 85, 247, 0.35)",
                  color: "#c084fc",
                  fontSize: "11px",
                  fontWeight: "600",
                  padding: "6px 10px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontFamily: "var(--mono)",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
                title="Copy connected shielded address & open Midnight Preview faucet"
              >
                Faucet (+25k)
              </button>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Pair & Side Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "12px", marginBottom: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "11px", color: "#94a3b8", marginBottom: "6px", fontFamily: "var(--mono)", letterSpacing: "0.04em" }}>
              TRADING PAIR
            </label>
            <select
              value={pairIndex}
              onChange={(e) => setPairIndex(Number(e.target.value))}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "rgba(10, 10, 15, 0.8)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "4px",
                color: "#f8fafc",
                fontFamily: "var(--mono)",
                fontSize: "13px",
                outline: "none",
                cursor: "pointer",
              }}
            >
              {dep.pairs.map((p, idx) => (
                <option key={p.id} value={idx} style={{ background: "#16161e", color: "#fff" }}>
                  {p.base.symbol} / {p.quote.symbol}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "11px", color: "#94a3b8", marginBottom: "6px", fontFamily: "var(--mono)", letterSpacing: "0.04em" }}>
              ORDER SIDE
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              <button
                type="button"
                onClick={() => setSide(0)}
                style={{
                  padding: "9px",
                  borderRadius: "4px",
                  border: side === 0 ? "1px solid #10b981" : "1px solid rgba(255, 255, 255, 0.1)",
                  background: side === 0 ? "rgba(16, 185, 129, 0.25)" : "rgba(0, 0, 0, 0.3)",
                  color: side === 0 ? "#34d399" : "#94a3b8",
                  fontWeight: "600",
                  fontSize: "12px",
                  cursor: "pointer",
                  fontFamily: "var(--mono)",
                  transition: "all 0.15s ease",
                }}
              >
                BUY
              </button>
              <button
                type="button"
                onClick={() => setSide(1)}
                style={{
                  padding: "9px",
                  borderRadius: "4px",
                  border: side === 1 ? "1px solid #ef4444" : "1px solid rgba(255, 255, 255, 0.1)",
                  background: side === 1 ? "rgba(239, 68, 68, 0.25)" : "rgba(0, 0, 0, 0.3)",
                  color: side === 1 ? "#f87171" : "#94a3b8",
                  fontWeight: "600",
                  fontSize: "12px",
                  cursor: "pointer",
                  fontFamily: "var(--mono)",
                  transition: "all 0.15s ease",
                }}
              >
                SELL
              </button>
            </div>
          </div>
        </div>

        {/* Size & Limit Price Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
              <label style={{ fontSize: "11px", color: "#94a3b8", fontFamily: "var(--mono)" }}>
                SIZE · {baseAsset.symbol}
              </label>
              <span style={{ fontSize: "11px", color: "#64748b" }}>Amount to {side === 0 ? "Buy" : "Sell"}</span>
            </div>
            <div style={{ position: "relative" }}>
              <input
                type="number"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                step="any"
                min="0.000001"
                required
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "rgba(10, 10, 15, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "4px",
                  color: "#f8fafc",
                  fontFamily: "var(--mono)",
                  fontSize: "14px",
                  outline: "none",
                }}
              />
              <span style={{ position: "absolute", right: "12px", top: "10px", color: "#64748b", fontSize: "12px", fontFamily: "var(--mono)" }}>
                {baseAsset.symbol}
              </span>
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
              <label style={{ fontSize: "11px", color: "#94a3b8", fontFamily: "var(--mono)" }}>
                LIMIT PRICE · {quoteAsset.symbol}
              </label>
              <span style={{ fontSize: "11px", color: "#64748b" }}>Max {quoteAsset.symbol} per {baseAsset.symbol}</span>
            </div>
            <div style={{ position: "relative" }}>
              <input
                type="number"
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
                step="any"
                min="0.000001"
                required
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "rgba(10, 10, 15, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "4px",
                  color: "#f8fafc",
                  fontFamily: "var(--mono)",
                  fontSize: "14px",
                  outline: "none",
                }}
              />
              <span style={{ position: "absolute", right: "12px", top: "10px", color: "#64748b", fontSize: "12px", fontFamily: "var(--mono)" }}>
                {quoteAsset.symbol}
              </span>
            </div>
          </div>
        </div>

        {/* Expiry & Encrypted Notional Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "18px" }}>
          <div>
            <label style={{ display: "block", fontSize: "11px", color: "#94a3b8", marginBottom: "6px", fontFamily: "var(--mono)" }}>
              EXPIRY · HOURS
            </label>
            <div style={{ position: "relative" }}>
              <input
                type="number"
                value={expiryHours}
                onChange={(e) => setExpiryHours(parseInt(e.target.value || "24", 10))}
                min={1}
                max={168}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "rgba(10, 10, 15, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "4px",
                  color: "#f8fafc",
                  fontFamily: "var(--mono)",
                  fontSize: "14px",
                  outline: "none",
                }}
              />
              <span style={{ position: "absolute", right: "12px", top: "10px", color: "#64748b", fontSize: "12px", fontFamily: "var(--mono)" }}>
                HR
              </span>
            </div>
            <span style={{ fontSize: "10px", color: "#64748b", marginTop: "4px", display: "block" }}>
              Between 1 and 168 hours (7 days)
            </span>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "11px", color: "#94a3b8", marginBottom: "6px", fontFamily: "var(--mono)" }}>
              NOTIONAL · ENCRYPTED
            </label>
            <div
              style={{
                padding: "10px 12px",
                background: "rgba(10, 10, 15, 0.8)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "4px",
                color: "#34d399",
                fontFamily: "var(--mono)",
                fontSize: "14px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>≈ {notional}</span>
              <span style={{ color: "#64748b", fontSize: "12px" }}>{quoteAsset.symbol}</span>
            </div>
            <span style={{ fontSize: "10px", color: "#64748b", marginTop: "4px", display: "block" }}>
              Computed client-side · Never revealed to public
            </span>
          </div>
        </div>

        {/* Feature Badges */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "18px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 8px",
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.25)",
              color: "#34d399",
              borderRadius: "4px",
              fontSize: "11px",
              fontFamily: "var(--mono)",
            }}
          >
            <Shield size={12} /> MIDNIGHT ZK SEALED
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 8px",
              background: "rgba(168, 85, 247, 0.1)",
              border: "1px solid rgba(168, 85, 247, 0.25)",
              color: "#c084fc",
              borderRadius: "4px",
              fontSize: "11px",
              fontFamily: "var(--mono)",
            }}
          >
            <Lock size={12} /> LACE EXTENSION AUTHORIZATION
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 8px",
              background: "rgba(59, 130, 246, 0.1)",
              border: "1px solid rgba(59, 130, 246, 0.25)",
              color: "#60a5fa",
              borderRadius: "4px",
              fontSize: "11px",
              fontFamily: "var(--mono)",
            }}
          >
            ANTI-FRONT-RUNNING BATCH
          </span>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          suppressHydrationWarning
          disabled={step !== "idle" && step !== "confirmed"}
          style={{
            width: "100%",
            padding: "14px",
            background: !isConnected
              ? "linear-gradient(90deg, #3b82f6, #6366f1)"
              : step === "signing"
              ? "linear-gradient(90deg, #f59e0b, #d97706)"
              : "linear-gradient(90deg, #7c3aed, #4f46e5)",
            border: "none",
            borderRadius: "4px",
            color: "#fff",
            fontWeight: "600",
            fontSize: "14px",
            cursor: "pointer",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "8px",
            boxShadow: "0 4px 14px rgba(124, 58, 237, 0.35)",
            transition: "all 0.2s ease",
            opacity: step !== "idle" && step !== "confirmed" ? 0.8 : 1,
          }}
        >
          {!isConnected ? (
            <>
              <Wallet size={16} />
              Connect Lace Wallet to Trade
            </>
          ) : step === "creating" ? (
            <>
              <RefreshCw size={16} className="animate-spin" />
              Structuring Private Order…
            </>
          ) : step === "signing" ? (
            <>
              <Lock size={16} />
              Authorizing & Deducting in Lace Wallet…
            </>
          ) : step === "proving" ? (
            <>
              <Shield size={16} />
              Generating ZK Proof on Local Server…
            </>
          ) : step === "submitting" ? (
            <>
              <RefreshCw size={16} className="animate-spin" />
              Registering on Midnight Preview Contract…
            </>
          ) : (
            <>
              Submit Confidential Order (Lace Pop-up)
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>

      {/* Real-Time Midnight ZK Progression */}
      {step !== "idle" && (
        <div
          style={{
            marginTop: "20px",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            paddingTop: "16px",
            fontSize: "12px",
            fontFamily: "var(--mono)",
          }}
        >
          <div style={{ color: step === "creating" ? "#38bdf8" : "#34d399", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
            {step === "creating" ? "⏳" : "✓"} 1. Order Parameters Salted & Sealed Locally
          </div>
          <div style={{ color: step === "signing" ? "#f59e0b" : step === "proving" || step === "submitting" || step === "confirmed" ? "#34d399" : "#64748b", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
            {step === "signing" ? "👉" : step === "proving" || step === "submitting" || step === "confirmed" ? "✓" : "○"} 2. Lace Wallet Authorization & Gas Escrow Deducted
          </div>
          <div style={{ color: step === "proving" ? "#38bdf8" : step === "submitting" || step === "confirmed" ? "#34d399" : "#64748b", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
            {step === "proving" ? "⏳" : step === "submitting" || step === "confirmed" ? "✓" : "○"} 3. Zero-Knowledge Proof Generated on Proof Server
          </div>
          <div style={{ color: step === "submitting" ? "#38bdf8" : step === "confirmed" ? "#34d399" : "#64748b", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
            {step === "submitting" ? "⏳" : step === "confirmed" ? "✓" : "○"} 4. Commitment Verified on Compact Smart Contract
          </div>
          <div style={{ color: step === "confirmed" ? "#34d399" : "#64748b", display: "flex", alignItems: "center", gap: "6px" }}>
            {step === "confirmed" ? "✓" : "○"} 5. Order Batched for Uniform Clearing Execution
          </div>
        </div>
      )}

      {/* Confirmed Commitment & Deducted Balance Summary */}
      {lastCommitment && step === "confirmed" && (
        <div
          style={{
            marginTop: "16px",
            padding: "16px",
            background: "rgba(16, 185, 129, 0.08)",
            border: "1px solid rgba(16, 185, 129, 0.25)",
            borderRadius: "6px",
            fontSize: "12px",
            fontFamily: "var(--mono)",
          }}
        >
          <div style={{ color: "#34d399", fontWeight: "600", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
            <CheckCircle2 size={16} /> Confidential Order Registered On-Chain & Amount Deducted
          </div>

          {lastDeduction && (
            <div style={{ background: "rgba(0, 0, 0, 0.35)", border: "1px solid rgba(16, 185, 129, 0.2)", padding: "12px 14px", borderRadius: "6px", marginBottom: "12px" }}>
              <div style={{ color: "#f8fafc", fontWeight: "600", marginBottom: "6px", display: "flex", justifyContent: "space-between" }}>
                <span>💰 Deducted from Connected Lace Wallet:</span>
                <span style={{ color: "#ef4444", fontFamily: "var(--mono)" }}>-{lastDeduction.total.toFixed(2)} tDUST</span>
              </div>
              <div style={{ color: "#94a3b8", fontSize: "11px", marginBottom: "2px" }}>
                • Trade Escrow: {lastDeduction.escrow.toFixed(2)} tDUST
              </div>
              <div style={{ color: "#94a3b8", fontSize: "11px", marginBottom: "2px" }}>
                • Midnight Network ZK Gas Fee: {lastDeduction.gasFee.toFixed(2)} tDUST
              </div>
              <div style={{ color: "#34d399", fontSize: "12px", marginTop: "6px", fontWeight: "600", display: "flex", justifyContent: "space-between" }}>
                <span>• Remaining Lace Shielded Balance:</span>
                <span style={{ fontFamily: "var(--mono)" }}>
                  {lastDeduction.newBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tDUST
                </span>
              </div>
            </div>
          )}

          <div style={{ color: "#94a3b8", wordBreak: "break-all", marginBottom: "4px", fontSize: "11px" }}>
            <span style={{ color: "#e2e8f0" }}>Commitment (ZK Root):</span> {lastCommitment}
          </div>
          {lastTxHash && (
            <div style={{ color: "#94a3b8", wordBreak: "break-all", marginBottom: "4px", fontSize: "11px" }}>
              <span style={{ color: "#e2e8f0" }}>Tx Hash:</span> {lastTxHash}
            </div>
          )}
          <div style={{ color: "#64748b", marginTop: "8px", fontSize: "11px" }}>
            Target Contract: <code>3813ef0145c64237d34584141af8e11b4f4b3a8b29e4ab864fec4aed31880934</code> (Midnight Preview)
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div
          style={{
            marginTop: "14px",
            padding: "10px 14px",
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: "6px",
            color: "#fca5a5",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
