import { MarketCandles } from "@/components/MarketCandles";
import { PageHead } from "@/components/atoms";

export default function MarketsPage() {
  return (
    <>
      <PageHead
        num="02 · Markets"
        title="Clearing"
        em="candles"
        meta={<>SETTLED MATCHES ONLY<br />BATCH-AUCTION OHLCV</>}
      />
      <MarketCandles />
    </>
  );
}
