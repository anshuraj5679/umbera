import { PageHead } from "@/components/atoms";
import { BalanceCard } from "@/components/BalanceCard";
import { FaucetPanel } from "@/components/FaucetPanel";
import { WrapPanel } from "@/components/WrapPanel";
import { OperatorPanel } from "@/components/OperatorPanel";

export default function SetupPage() {
  return (
    <>
      <PageHead
        num="02 · Setup"
        title="Trader"
        em="setup"
        meta={<>FAUCET · WRAP · APPROVE<br />ONE-TIME PER TOKEN</>}
      />
      <div className="col" style={{ gap: 40 }}>
        <BalanceCard />
        <FaucetPanel />
        <WrapPanel />
        <OperatorPanel />
      </div>
    </>
  );
}
