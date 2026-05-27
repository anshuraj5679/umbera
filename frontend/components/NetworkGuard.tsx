"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import type { ReactNode } from "react";

export function NetworkGuard({ children }: { children: ReactNode }) {
  const { isConnected, chain } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected) return <>{children}</>;
  if (!chain || chain.id !== arbitrumSepolia.id) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center">
        <p className="text-amber-400">Wrong network. Switch to Arbitrum Sepolia (chainId 421614).</p>
        <button
          disabled={isPending}
          onClick={() => switchChain({ chainId: arbitrumSepolia.id })}
          className="mt-3 rounded bg-emerald-600 px-4 py-2 disabled:opacity-50"
        >
          {isPending ? "Switching…" : "Switch network"}
        </button>
      </div>
    );
  }
  return <>{children}</>;
}
