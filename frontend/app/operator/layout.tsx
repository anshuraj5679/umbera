"use client";

import { useAccount } from "wagmi";
import { useMatcher } from "@/lib/dex";
import { PageHead } from "@/components/atoms";
import { shortHex } from "@/lib/format";

const DEMO_OPERATOR_ADDRESSES = new Set([
  "0x060613a360ffe3213818c022b404e5aa9d755611",
]);

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const { data: matcher, isLoading } = useMatcher();

  if (!isConnected || !address) {
    return (
      <>
        <PageHead num="05 · Operator" title="Matcher" em="console" meta="GATED · ROLE: MATCHER" />
        <div className="gate">
          <div className="gate__icon" />
          <div className="gate__title">Connect Wallet</div>
          <div className="gate__msg">Operator console requires a wallet with the matcher role</div>
        </div>
      </>
    );
  }
  if (isLoading || !matcher) {
    return (
      <>
        <PageHead num="05 · Operator" title="Matcher" em="console" meta="VERIFYING ROLE…" />
        <div className="gate">
          <div className="gate__icon" />
          <div className="gate__title">Loading…</div>
          <div className="gate__msg">Verifying matcher key on-chain</div>
        </div>
      </>
    );
  }
  const connected = address.toLowerCase();
  const matcherAddress = matcher as string;
  const isMatcher = connected === matcherAddress.toLowerCase();
  const isDemoOperator = DEMO_OPERATOR_ADDRESSES.has(connected);

  if (!isMatcher && !isDemoOperator) {
    return (
      <>
        <PageHead num="05 · Operator" title="Matcher" em="console" meta="UNAUTHORIZED" />
        <div className="gate gate--error">
          <div className="gate__icon" />
          <div className="gate__title">Not Authorized</div>
          <div className="gate__msg">
            Connected {shortHex(address, 4)} but matcher is {shortHex(matcherAddress, 4)}.
            For this demo, use the matcher wallet or an approved demo operator wallet.
          </div>
        </div>
      </>
    );
  }
  return <>{children}</>;
}
