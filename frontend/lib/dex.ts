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
  chainId: 0, // Midnight Network
  dex: process.env.NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS ?? "3813ef0145c64237d34584141af8e11b4f4b3a8b29e4ab864fec4aed31880934",
  underlying: {
    mtDUST: "midnight:asset:tDUST",
    mTKA: "midnight:asset:TKA",
    mTKB: "midnight:asset:TKB",
  },
  pairs: [
    {
      id: 0,
      base: {
        symbol: "tDUST",
        name: "Test DUST",
        decimals: 6,
        address: "midnight:asset:tDUST",
      },
      quote: {
        symbol: "TKA",
        name: "Token A (Private)",
        decimals: 6,
        address: "midnight:asset:TKA",
      },
    },
    {
      id: 1,
      base: {
        symbol: "TKA",
        name: "Token A (Private)",
        decimals: 6,
        address: "midnight:asset:TKA",
      },
      quote: {
        symbol: "TKB",
        name: "Token B (Private)",
        decimals: 18,
        address: "midnight:asset:TKB",
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
