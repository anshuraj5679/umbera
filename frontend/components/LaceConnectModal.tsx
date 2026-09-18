"use client";

import React, { useState } from "react";
import { useMidnight } from "../midnight/provider";
import { Wallet, X, ExternalLink, RefreshCw, Zap, CheckCircle2, AlertCircle, Shield } from "lucide-react";

export function LaceConnectModal() {
  const {
    isConnectModalOpen,
    closeConnectModal,
    isLaceAvailable,
    connectWallet,
    connectSimulatedWallet,
    wallet,
  } = useMidnight();

  const [connectingExt, setConnectingExt] = useState(false);
  const [extError, setExtError] = useState<string | null>(null);

  if (!isConnectModalOpen) return null;

  const handleConnectExtension = async () => {
    setConnectingExt(true);
    setExtError(null);
    try {
      await connectWallet();
      // If extension was unlocked and accepted, connectWallet closes the modal
    } catch (err: any) {
      setExtError(err?.message || "Failed to connect to Lace extension.");
    } finally {
      setConnectingExt(false);
    }
  };

  const handleLaunchDemo = () => {
    connectSimulatedWallet();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        background: "rgba(3, 4, 7, 0.82)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeConnectModal();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "480px",
          background: "linear-gradient(180deg, rgba(22, 22, 30, 0.98), rgba(12, 12, 18, 0.99))",
          border: "1px solid rgba(255, 255, 255, 0.14)",
          borderRadius: "12px",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(168, 85, 247, 0.15)",
          padding: "24px",
          color: "#f8fafc",
          position: "relative",
          animation: "fadeIn 0.2s ease-out",
        }}
      >
        {/* Close Button */}
        <button
          onClick={closeConnectModal}
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "6px",
            width: "32px",
            height: "32px",
            display: "grid",
            placeItems: "center",
            color: "#94a3b8",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
          title="Close"
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "18px" }}>
          <div
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "10px",
              background: "linear-gradient(135deg, rgba(168, 85, 247, 0.25), rgba(99, 102, 241, 0.25))",
              border: "1px solid rgba(168, 85, 247, 0.4)",
              display: "grid",
              placeItems: "center",
              color: "#c084fc",
            }}
          >
            <Wallet size={22} />
          </div>
          <div>
            <h3 style={{ fontSize: "18px", fontWeight: "600", color: "#fff", margin: 0 }}>
              Connect Lace Wallet
            </h3>
            <div style={{ fontSize: "12px", color: "#94a3b8", display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
              <span>Midnight Network</span>
              <span>•</span>
              <span style={{ color: "#a855f7" }}>Preview Testnet</span>
            </div>
          </div>
        </div>

        {/* Extension Detection Status */}
        <div
          style={{
            padding: "12px 14px",
            borderRadius: "8px",
            background: isLaceAvailable ? "rgba(16, 185, 129, 0.08)" : "rgba(245, 158, 11, 0.08)",
            border: `1px solid ${isLaceAvailable ? "rgba(16, 185, 129, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
            marginBottom: "18px",
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
          }}
        >
          {isLaceAvailable ? (
            <CheckCircle2 size={18} style={{ color: "#34d399", marginTop: "1px", flexShrink: 0 }} />
          ) : (
            <AlertCircle size={18} style={{ color: "#fbbf24", marginTop: "1px", flexShrink: 0 }} />
          )}
          <div style={{ fontSize: "12px", lineHeight: 1.5 }}>
            <div style={{ fontWeight: "600", color: isLaceAvailable ? "#34d399" : "#fbbf24" }}>
              {isLaceAvailable
                ? "Lace Extension Detected in Browser"
                : "Lace Extension Not Detected or Midnight Beta Disabled"}
            </div>
            <div style={{ color: "#cbd5e1", marginTop: "2px" }}>
              {isLaceAvailable
                ? "Click below to approve connection in your Lace pop-up."
                : "The Midnight DApp connector (window.midnight.mnLace) is not active in this tab."}
            </div>
          </div>
        </div>

        {extError && (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "6px",
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              color: "#fca5a5",
              fontSize: "12px",
              marginBottom: "14px",
            }}
          >
            {extError}
          </div>
        )}

        {/* Primary Option: Real Extension */}
        <div style={{ marginBottom: "18px" }}>
          {isLaceAvailable ? (
            <button
              onClick={handleConnectExtension}
              disabled={connectingExt}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "6px",
                background: "linear-gradient(90deg, #7c3aed, #6366f1)",
                border: "none",
                color: "#fff",
                fontWeight: "600",
                fontSize: "14px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                boxShadow: "0 4px 14px rgba(124, 58, 237, 0.4)",
              }}
            >
              {connectingExt ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  Requesting Lace Pop-up…
                </>
              ) : (
                <>
                  <Wallet size={16} />
                  Connect Detected Lace Extension
                </>
              )}
            </button>
          ) : (
            <div
              style={{
                background: "rgba(0, 0, 0, 0.35)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "8px",
                padding: "14px",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: "600", color: "#e2e8f0", marginBottom: "8px" }}>
                How to enable Lace for Midnight:
              </div>
              <ol
                style={{
                  fontSize: "12px",
                  color: "#94a3b8",
                  paddingLeft: "18px",
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                <li>
                  Install{" "}
                  <a
                    href="https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhbhflkgnhkhgaj"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#a855f7", textDecoration: "underline" }}
                  >
                    Lace Wallet from Chrome Web Store <ExternalLink size={10} style={{ display: "inline" }} />
                  </a>
                </li>
                <li>Open Lace & click <strong>Settings (⚙️) → Beta features</strong></li>
                <li>Toggle <strong>&ldquo;Midnight Network&rdquo;</strong> to <strong>ON</strong></li>
                <li>Unlock your wallet and refresh this page</li>
              </ol>

              <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                <a
                  href="https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhbhflkgnhkhgaj"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "8px",
                    borderRadius: "4px",
                    background: "rgba(255, 255, 255, 0.06)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    color: "#f1f5f9",
                    fontSize: "12px",
                    textDecoration: "none",
                    fontWeight: "500",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                  }}
                >
                  <ExternalLink size={13} />
                  Get Lace Extension
                </a>
                <button
                  type="button"
                  onClick={handleConnectExtension}
                  disabled={connectingExt}
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: "4px",
                    background: "rgba(168, 85, 247, 0.15)",
                    border: "1px solid rgba(168, 85, 247, 0.35)",
                    color: "#c084fc",
                    fontSize: "12px",
                    fontWeight: "500",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                  }}
                >
                  <RefreshCw size={13} className={connectingExt ? "animate-spin" : ""} />
                  Retry Detect
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            margin: "18px 0",
            fontSize: "11px",
            color: "#64748b",
            fontFamily: "var(--mono)",
          }}
        >
          <div style={{ flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.1)" }} />
          <span>INSTANT DEMO MODE</span>
          <div style={{ flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.1)" }} />
        </div>

        {/* Instant Testnet Demo Option */}
        <div
          style={{
            background: "linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(6, 78, 59, 0.15))",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            borderRadius: "8px",
            padding: "14px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <span style={{ fontSize: "13px", fontWeight: "600", color: "#34d399", display: "flex", alignItems: "center", gap: "6px" }}>
              <Zap size={14} /> 1-Click Instant Testnet Account
            </span>
            <span
              style={{
                fontSize: "10px",
                fontFamily: "var(--mono)",
                background: "rgba(16, 185, 129, 0.2)",
                color: "#6ee7b7",
                padding: "2px 6px",
                borderRadius: "4px",
              }}
            >
              25,000 tDUST
            </span>
          </div>
          <p style={{ fontSize: "12px", color: "#94a3b8", margin: "0 0 12px 0", lineHeight: 1.5 }}>
            No extension required. Instantly simulates a funded Midnight shielded account so you can test confidential ZK order commitments, batches, and settlements.
          </p>

          <button
            type="button"
            onClick={handleLaunchDemo}
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "6px",
              background: "linear-gradient(90deg, #10b981, #059669)",
              border: "none",
              color: "#fff",
              fontWeight: "600",
              fontSize: "13px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
            }}
          >
            <Zap size={14} />
            Launch Instant Testnet Wallet
          </button>
        </div>

        {/* Security Note */}
        <div
          style={{
            marginTop: "16px",
            textAlign: "center",
            fontSize: "11px",
            color: "#64748b",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
          }}
        >
          <Shield size={12} />
          <span>Non-custodial: Private keys &amp; proofs never leave your browser.</span>
        </div>
      </div>
    </div>
  );
}
