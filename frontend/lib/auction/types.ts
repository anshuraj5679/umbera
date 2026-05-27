export type Side = "BUY" | "SELL";

export type DecryptedOrder = {
  id: bigint;
  side: Side;
  remainingDeposit: bigint;
  remainingRequest: bigint;
  cashDecimals: number;
  assetDecimals: number;
};

export type AuctionMatch = {
  buyOrderId: bigint;
  sellOrderId: bigint;
  assetAmount: bigint;
  cashAmount: bigint;
};

export type AuctionResult = {
  clearingPriceQuotePerBase: bigint;
  clearingPriceQuotePerBaseScaled: bigint;
  matches: AuctionMatch[];
};
