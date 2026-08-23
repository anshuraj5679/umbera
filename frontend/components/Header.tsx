"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useSwitchChain } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { shortHex } from "@/lib/format";
import { useMidnight } from "@/midnight/provider";

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
  const { isConnected, chain } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const { wallet, connectWallet, disconnectWallet, isLaceAvailable } = useMidnight();
  const wrongNet = Boolean(isConnected && chain && chain.id !== arbitrumSepolia.id);

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
          {/* Midnight Preprod Indicator */}
          <span className="net-pill" title="Midnight Preprod Network">
            <span className="net-pill__dot" style={{ background: "var(--violet, #8b5cf6)", boxShadow: "0 0 6px var(--violet, #8b5cf6)" }} />
            <span>Midnight Preprod</span>
          </span>

          {/* Lace Wallet Connector */}
          {wallet.connected && wallet.address ? (
            <button
              className="btn btn--ghost btn--sm"
              onClick={disconnectWallet}
              title="Click to disconnect Lace Wallet"
            >
              <span style={{ width: 6, height: 6, background: "var(--emerald)", borderRadius: "50%", boxShadow: "0 0 6px var(--emerald)" }} />
              Lace: {shortHex(wallet.address, 4)}
            </button>
          ) : (
            <button
              className="btn btn--primary btn--sm"
              onClick={connectWallet}
              title={isLaceAvailable ? "Connect Lace Wallet" : "Lace extension not detected"}
            >
              Connect Lace
            </button>
          )}

          {/* EVM Wallet Connector Fallback */}
          <ConnectButton.Custom>
            {({ account, openConnectModal, openAccountModal, mounted }) => {
              if (!mounted) return null;
              if (!account) return null;
              return (
                <button className="btn btn--ghost btn--sm" onClick={openAccountModal} title="EVM Wallet">
                  EVM: {shortHex(account.address, 4)}
                </button>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </div>
    </header>
  );
}
