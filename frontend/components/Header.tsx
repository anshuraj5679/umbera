"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { shortHex } from "@/lib/format";
import { useMidnight } from "@/midnight/provider";
import { Wallet, LogOut } from "lucide-react";
import { toast } from "sonner";

const NAV = [
  { href: "/pool", label: "Trade" },
  { href: "/markets", label: "Markets" },
  { href: "/setup", label: "Setup" },
  { href: "/orders", label: "Orders" },
  { href: "/batches", label: "Batches" },
  { href: "/privacy", label: "Privacy" },
  { href: "/architecture", label: "Architecture" },
  { href: "/health", label: "Health" },
];

export function Header() {
  const pathname = usePathname();
  const { wallet, dustBalance, connectWallet, disconnectWallet, isLaceAvailable } = useMidnight();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleConnectClick = async () => {
    try {
      if (isLaceAvailable) {
        toast.info("Connecting to Lace Extension", {
          description: "Approve site access in your Lace extension window.",
        });
      }
      await connectWallet();
    } catch (err: any) {
      toast.error("Lace Connection Notice", {
        description: err?.message ?? "Could not connect to Lace wallet.",
      });
    }
  };

  const handleDisconnect = () => {
    disconnectWallet();
    toast.info("Lace Wallet Disconnected");
  };

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <a href="/" className="brand" title="Back to landing">
          <span className="brand__mark" />
          <span>UMBRA</span>
          <span className="brand__sub">Midnight Dark Pool</span>
        </a>

        <nav className="nav-links">
          {NAV.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={active ? "is-active" : ""}>
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="header-cta" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {/* Midnight Preview Indicator */}
          <span className="net-pill" title="Midnight Preview Network (Native Zero-Knowledge)">
            <span
              className="net-pill__dot"
              style={{ background: "var(--violet, #8b5cf6)", boxShadow: "0 0 6px var(--violet, #8b5cf6)" }}
            />
            <span>Midnight Preview</span>
          </span>

          {/* Dedicated Lace Wallet Connector */}
          {mounted && wallet.connected && wallet.address ? (
            <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
              <span
                className="btn btn--ghost btn--sm"
                style={{
                  cursor: "default",
                  borderColor: "rgba(16, 185, 129, 0.4)",
                  background: "rgba(16, 185, 129, 0.1)",
                  color: "#ecfdf5",
                  display: "flex",
                  gap: "6px",
                  alignItems: "center",
                }}
                title={`Connected Shielded Address: ${wallet.address}`}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    background: "var(--emerald, #10b981)",
                    borderRadius: "50%",
                    boxShadow: "0 0 6px var(--emerald, #10b981)",
                  }}
                />
                <span>Lace: {shortHex(wallet.address, 4)}</span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: "600",
                    color: "#34d399",
                    background: "rgba(16, 185, 129, 0.2)",
                    padding: "1px 6px",
                    borderRadius: "4px",
                    fontFamily: "var(--mono)",
                  }}
                >
                  {dustBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tDUST
                </span>
              </span>
              <button
                className="btn btn--ghost btn--sm"
                style={{ padding: "6px 8px", color: "var(--silver-edge, #94a3b8)" }}
                onClick={handleDisconnect}
                title="Disconnect Lace Wallet"
              >
                <LogOut size={12} />
              </button>
            </div>
          ) : (
            <button
              className="btn btn--primary btn--sm"
              onClick={handleConnectClick}
              title={isLaceAvailable ? "Click to connect Lace extension" : "Lace extension not detected. Please install Lace (Midnight Edition)."}
            >
              <Wallet size={13} style={{ marginRight: 4 }} />
              Connect Lace
            </button>
          )}
        </div>
      </div>

      {wallet.error && (
        <div
          style={{
            background: "rgba(239, 68, 68, 0.15)",
            color: "#fca5a5",
            fontSize: "12px",
            padding: "4px 16px",
            textAlign: "center",
            borderBottom: "1px solid rgba(239, 68, 68, 0.3)",
          }}
        >
          Lace Wallet Notice: {wallet.error}
        </div>
      )}
    </header>
  );
}
