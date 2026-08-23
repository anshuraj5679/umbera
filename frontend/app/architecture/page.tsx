"use client";

import React, { useState } from "react";

type ArchComponent = {
  id: string;
  name: string;
  sub: string;
  desc: string;
  tech: string;
  privacyRole: string;
};

const COMPONENTS: ArchComponent[] = [
  {
    id: "lace",
    name: "Lace Wallet",
    sub: "Midnight DApp Connector",
    desc: "Provides secure key management and network authentication. Requests user approval for transactions without ever exposing private keys or seed phrases.",
    tech: "window.midnight.mnLace",
    privacyRole: "User Identity & Key Isolation",
  },
  {
    id: "dapp",
    name: "UMBRA DApp",
    sub: "Next.js UI & Local Privacy Layer",
    desc: "Frontend interface for managing confidential order parameters. Computes commitments locally using private inputs.",
    tech: "Next.js 14, React 18, TypeScript",
    privacyRole: "Local Order Structuring & UI",
  },
  {
    id: "midnightjs",
    name: "Midnight.js",
    sub: "TypeScript Client SDK",
    desc: "Framework connecting the DApp to the indexer, proof server, and ledger node.",
    tech: "@midnight-ntwrk/midnight-js-* v4.0.4",
    privacyRole: "Provider Orchestration",
  },
  {
    id: "compact",
    name: "Compact Contract",
    sub: "obsidian.compact Circuits",
    desc: "Smart contract compiled to ZK circuits. Manages order commitments, nullifiers, and batch lifecycle without reading private order data.",
    tech: "Compact DSL (Minokawa)",
    privacyRole: "On-Chain Zero-Knowledge Verification",
  },
  {
    id: "proofserver",
    name: "Local Proof Server",
    sub: "Docker Container (Port 6300)",
    desc: "Generates zero-knowledge proofs locally on the user's machine so secret inputs never cross the network.",
    tech: "midnightntwrk/proof-server:8.1.0",
    privacyRole: "Client-Side ZK Proving",
  },
  {
    id: "preprod",
    name: "Midnight Preprod",
    sub: "Testnet Ledger & Indexer",
    desc: "Shielded ledger recording commitments, batch statuses, and settlement receipts.",
    tech: "Midnight Preprod / Blockfrost API",
    privacyRole: "Public Verifiable Ledger",
  },
  {
    id: "matcher",
    name: "Batch Matcher",
    sub: "Off-Chain Matching Engine",
    desc: "Orchestrates batch closing, calculates uniform clearing prices, and submits settlement proofs.",
    tech: "Node.js Matcher Daemon & PostgreSQL",
    privacyRole: "Batch Auction Execution",
  },
  {
    id: "audit",
    name: "Public Audit System",
    sub: "Receipt Verification",
    desc: "Cryptographic proof receipts (obsidian.match.proof-receipt.v3) verifying fair match execution.",
    tech: "Digest Receipts & Verification API",
    privacyRole: "Receipt-Only Verification",
  },
];

export default function ArchitecturePage() {
  const [selected, setSelected] = useState<ArchComponent>(COMPONENTS[0]);

  return (
    <div className="container" style={{ padding: "40px 20px", maxWidth: "1000px", margin: "0 auto" }}>
      <header style={{ marginBottom: "36px" }}>
        <h1 style={{ fontSize: "32px", fontWeight: "600", color: "#f3f4f6", marginBottom: "12px", fontFamily: "var(--font-serif, serif)" }}>
          Protocol Architecture & Flow
        </h1>
        <p style={{ fontSize: "15px", color: "#9ca3af", lineHeight: "1.6" }}>
          Interactive breakdown of the Midnight-native confidential dark pool stack. Click any component to inspect its implementation responsibilities and privacy guarantees.
        </p>
      </header>

      {/* Interactive Flow Diagram */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "12px",
          marginBottom: "32px",
        }}
      >
        {COMPONENTS.map((comp, idx) => {
          const active = comp.id === selected.id;
          return (
            <button
              key={comp.id}
              onClick={() => setSelected(comp)}
              style={{
                background: active ? "rgba(139, 92, 246, 0.25)" : "rgba(30, 41, 59, 0.5)",
                border: active ? "1px solid rgba(139, 92, 246, 0.8)" : "1px solid rgba(148, 163, 184, 0.15)",
                borderRadius: "6px",
                padding: "16px",
                textAlign: "left",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ fontSize: "11px", color: active ? "#c084fc" : "#64748b", fontFamily: "var(--mono)", marginBottom: "4px" }}>
                STEP {idx + 1}
              </div>
              <div style={{ fontSize: "14px", fontWeight: "600", color: active ? "#f8fafc" : "#cbd5e1" }}>
                {comp.name}
              </div>
              <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
                {comp.sub}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Component Detail Box */}
      <div
        style={{
          background: "rgba(15, 23, 42, 0.8)",
          border: "1px solid rgba(139, 92, 246, 0.4)",
          borderRadius: "8px",
          padding: "28px",
          boxShadow: "0 8px 30px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 style={{ fontSize: "22px", fontWeight: "600", color: "#f8fafc", marginBottom: "4px" }}>
              {selected.name}
            </h2>
            <span style={{ fontSize: "13px", color: "#c084fc", fontFamily: "var(--mono)" }}>
              {selected.sub}
            </span>
          </div>
          <span
            style={{
              fontSize: "12px",
              padding: "4px 10px",
              borderRadius: "4px",
              background: "rgba(139, 92, 246, 0.2)",
              border: "1px solid rgba(139, 92, 246, 0.4)",
              color: "#e9d5ff",
              fontFamily: "var(--mono)",
            }}
          >
            {selected.privacyRole}
          </span>
        </div>

        <p style={{ fontSize: "14px", color: "#cbd5e1", lineHeight: "1.7", marginBottom: "20px" }}>
          {selected.desc}
        </p>

        <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.1)", paddingTop: "16px", display: "flex", gap: "24px", fontSize: "13px" }}>
          <div>
            <span style={{ color: "#64748b" }}>Technology: </span>
            <span style={{ color: "#f1f5f9", fontFamily: "var(--mono)" }}>{selected.tech}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
