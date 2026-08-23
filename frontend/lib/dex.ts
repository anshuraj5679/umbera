/**
 * Midnight Network — UMBRA Asset & Pair Deployment Helper
 *
 * Provides pair definitions (TOKEN_A / TOKEN_B) and network metadata.
 * Free of legacy EVM contracts, FHERC20, or Solidity dependencies.
 *
 * @module lib/dex
 */

export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  address: string;
}

export interface PairInfo {
  id: number;
  base: TokenInfo;
  quote: TokenInfo;
}

export interface DeploymentConfig {
  chainId: number;
  dex: string;
  underlying: Record<string, string>;
  pairs: PairInfo[];
}

export const DEFAULT_DEPLOYMENT: DeploymentConfig = {
  chainId: parseInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? "421614", 10),
  dex: process.env.NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS ?? "0x0000000000000000000000000000000000000000",
  underlying: {
    mUSDC: "0x0000000000000000000000000000000000000010",
    mWETH: "0x0000000000000000000000000000000000000011",
    mWBTC: "0x0000000000000000000000000000000000000012",
  },
  pairs: [
    {
      id: 0,
      base: {
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        address: "0x0000000000000000000000000000000000000001",
      },
      quote: {
        symbol: "WETH",
        name: "Wrapped Ether",
        decimals: 18,
        address: "0x0000000000000000000000000000000000000002",
      },
    },
    {
      id: 1,
      base: {
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        address: "0x0000000000000000000000000000000000000001",
      },
      quote: {
        symbol: "WBTC",
        name: "Wrapped Bitcoin",
        decimals: 8,
        address: "0x0000000000000000000000000000000000000003",
      },
    },
  ],
};

export function deployment(): DeploymentConfig {
  return DEFAULT_DEPLOYMENT;
}

export function useMatcher(): { data?: string; matcher?: string; isMatcher: boolean; isLoading: boolean } {
  return { data: undefined, matcher: undefined, isMatcher: false, isLoading: false };
}

export const dexAbi: any[] = [];
