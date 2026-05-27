"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useSwitchChain } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { shortHex } from "@/lib/format";

const NAV = [
  { href: "/pool", label: "Trade" },
  { href: "/markets", label: "Markets" },
  { href: "/setup", label: "Setup" },
  { href: "/orders", label: "Orders" },
  { href: "/batches", label: "Batches" },
  { href: "/health", label: "Health" },
  { href: "/operator", label: "Operator" },
];

export function Header() {
  const pathname = usePathname();
  const { isConnected, chain } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const wrongNet = Boolean(isConnected && chain && chain.id !== arbitrumSepolia.id);

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <a href="/" className="brand" title="Back to landing">
          <span className="brand__mark" />
          <span>Obsidian</span>
          <span className="brand__sub">Dark Pool · v0.2.0</span>
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

        <div className="header-cta">
          <span className={"net-pill" + (wrongNet ? " is-wrong" : "")}>
            <span className="net-pill__dot" />
            <span>{wrongNet ? "Wrong Network" : "Arbitrum Sepolia"}</span>
          </span>
          <ConnectButton.Custom>
            {({ account, openConnectModal, openAccountModal, mounted }) => {
              if (!mounted) return null;
              if (!account) {
                return (
                  <button className="btn btn--primary btn--sm" onClick={openConnectModal}>
                    Connect Wallet
                  </button>
                );
              }
              return (
                <button className="btn btn--ghost btn--sm" onClick={openAccountModal}>
                  <span style={{ width: 6, height: 6, background: "var(--emerald)", borderRadius: "50%", boxShadow: "0 0 6px var(--emerald)" }} />
                  {shortHex(account.address, 4)}
                </button>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </div>
      {wrongNet && (
        <div className="netguard">
          <span className="netguard__msg">
            You're on the wrong chain — Obsidian operates on Arbitrum Sepolia.
          </span>
          <button
            className="btn btn--sm"
            disabled={isPending}
            onClick={() => switchChain({ chainId: arbitrumSepolia.id })}
          >
            {isPending ? "Switching…" : "Switch Network"}
          </button>
        </div>
      )}
    </header>
  );
}
