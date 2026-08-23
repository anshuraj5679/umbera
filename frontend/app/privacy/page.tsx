"use client";

import React from "react";
import { PRIVACY_CLASSIFICATION } from "@/midnight";

export default function PrivacyPage() {
  return (
    <div className="container" style={{ padding: "40px 20px", maxWidth: "960px", margin: "0 auto" }}>
      <header style={{ marginBottom: "36px" }}>
        <h1 style={{ fontSize: "32px", fontWeight: "600", color: "#f3f4f6", marginBottom: "12px", fontFamily: "var(--font-serif, serif)" }}>
          Confidentiality & Privacy Model
        </h1>
        <p style={{ fontSize: "15px", color: "#9ca3af", lineHeight: "1.6" }}>
          UMBRA is a privacy-first confidential batch-auction DEX on Midnight Network.
          Trading intent remains strictly confidential in local client private state while execution is verifiably proven via zero-knowledge proofs.
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px", marginBottom: "40px" }}>
        {/* PRIVATE STATE */}
        <div
          style={{
            background: "rgba(17, 24, 39, 0.7)",
            border: "1px solid rgba(139, 92, 246, 0.3)",
            borderRadius: "8px",
            padding: "24px",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#8b5cf6", boxShadow: "0 0 8px #8b5cf6" }} />
            <h2 style={{ fontSize: "18px", fontWeight: "600", color: "#e5e7eb" }}>WHAT IS PRIVATE?</h2>
          </div>
          <p style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "16px" }}>
            Stored strictly in local client encrypted state. Never disclosed to public ledger or third parties.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {PRIVACY_CLASSIFICATION.private.map((item, idx) => (
              <li key={idx} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255, 255, 255, 0.05)", fontSize: "13px", color: "#d1d5db" }}>
                ✓ {item}
              </li>
            ))}
          </ul>
        </div>

        {/* PUBLIC STATE */}
        <div
          style={{
            background: "rgba(17, 24, 39, 0.7)",
            border: "1px solid rgba(75, 85, 99, 0.4)",
            borderRadius: "8px",
            padding: "24px",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#3b82f6", boxShadow: "0 0 8px #3b82f6" }} />
            <h2 style={{ fontSize: "18px", fontWeight: "600", color: "#e5e7eb" }}>WHAT IS PUBLIC?</h2>
          </div>
          <p style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "16px" }}>
            Visible on the Midnight ledger for public coordination and audit tracking.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {PRIVACY_CLASSIFICATION.public.map((item, idx) => (
              <li key={idx} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255, 255, 255, 0.05)", fontSize: "13px", color: "#d1d5db" }}>
                • {item}
              </li>
            ))}
          </ul>
        </div>

        {/* VERIFIABLE STATE */}
        <div
          style={{
            background: "rgba(17, 24, 39, 0.7)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            borderRadius: "8px",
            padding: "24px",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 8px #10b981" }} />
            <h2 style={{ fontSize: "18px", fontWeight: "600", color: "#e5e7eb" }}>WHAT IS VERIFIED?</h2>
          </div>
          <p style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "16px" }}>
            Cryptographically proven on-chain via Compact ZK circuits without revealing private values.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {PRIVACY_CLASSIFICATION.verifiable.map((item, idx) => (
              <li key={idx} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255, 255, 255, 0.05)", fontSize: "13px", color: "#d1d5db" }}>
                ⚡ {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section style={{ background: "rgba(30, 41, 59, 0.5)", border: "1px solid rgba(148, 163, 184, 0.1)", borderRadius: "8px", padding: "24px" }}>
        <h3 style={{ fontSize: "16px", fontWeight: "600", color: "#f8fafc", marginBottom: "8px" }}>
          Wave 1 Trust Boundary Note
        </h3>
        <p style={{ fontSize: "13px", color: "#9ca3af", lineHeight: "1.6" }}>
          Wave 1 uses a trusted matcher daemon to propose clearing prices for closed batch auctions. Order validity, commitment consistency, and nullifiers are cryptographically enforced on-chain by the Compact smart contract.
        </p>
      </section>
    </div>
  );
}
