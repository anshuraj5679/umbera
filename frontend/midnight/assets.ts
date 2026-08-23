/**
 * Midnight Network — Asset Configuration
 *
 * Abstract asset definitions for Midnight-native trading pairs.
 * Does NOT assume ERC-20 behavior or Ethereum token standards.
 *
 * @module midnight/assets
 */

export type MidnightAsset = {
  name: string;
  symbol: string;
  decimals: number;
  assetId: string | null;
  isFeeToken: boolean;
};

export const TDUST: MidnightAsset = {
  name: "Test DUST",
  symbol: "tDUST",
  decimals: 6,
  assetId: null,
  isFeeToken: true,
};

export const TOKEN_A: MidnightAsset = {
  name: process.env.TOKEN_A_NAME ?? "Token A",
  symbol: "TKA",
  decimals: parseInt(process.env.TOKEN_A_DECIMALS ?? "6", 10),
  assetId: null,
  isFeeToken: false,
};

export const TOKEN_B: MidnightAsset = {
  name: process.env.TOKEN_B_NAME ?? "Token B",
  symbol: "TKB",
  decimals: parseInt(process.env.TOKEN_B_DECIMALS ?? "18", 10),
  assetId: null,
  isFeeToken: false,
};

export const DEFAULT_PAIR = { base: TOKEN_A, quote: TOKEN_B } as const;

export function formatAssetAmount(amount: bigint, asset: MidnightAsset): string {
  const divisor = BigInt(10 ** asset.decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  const fracStr = fraction.toString().padStart(asset.decimals, "0");
  const trimmed = fracStr.replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${trimmed}`;
}
