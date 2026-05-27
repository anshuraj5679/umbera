import { deployment } from "@/lib/dex";

export type TokenSetupRow = {
  underlying: `0x${string}`;
  wrapper: `0x${string}`;
  symbol: string;
  underlyingSymbol: string;
  encryptedSymbol: string;
  decimals: number;
};

type DeploymentToken = {
  address: string;
  symbol: string;
  decimals: number;
};

export function tokenSetupRows(): TokenSetupRow[] {
  const dep = deployment();
  const underlying = dep.underlying as Record<string, string>;
  const rows: TokenSetupRow[] = [];
  const seen = new Set<string>();

  function add(token: DeploymentToken) {
    const key = token.address.toLowerCase();
    if (seen.has(key)) return;

    const symbol = token.symbol.replace(/^e/, "");
    const underlyingSymbol = `m${symbol}`;
    const underlyingAddress = underlying[underlyingSymbol];
    if (!underlyingAddress) {
      throw new Error(`Missing ${underlyingSymbol} for ${token.symbol} in deployment addresses`);
    }

    seen.add(key);
    rows.push({
      underlying: underlyingAddress as `0x${string}`,
      wrapper: token.address as `0x${string}`,
      symbol,
      underlyingSymbol,
      encryptedSymbol: token.symbol,
      decimals: token.decimals,
    });
  }

  for (const pair of dep.pairs) {
    add(pair.base);
    add(pair.quote);
  }

  return rows;
}
