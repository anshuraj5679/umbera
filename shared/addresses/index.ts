import local from "./.deployed-local.json" with { type: "json" };
import arbSepolia from "./.deployed-arbSepolia.json" with { type: "json" };

export type Deployment = {
  chainId: number;
  updatedAt?: string;
  dex: `0x${string}`;
  pairs: Array<{
    id: number;
    base: { address: `0x${string}`; symbol: string; decimals: number };
    quote: { address: `0x${string}`; symbol: string; decimals: number };
  }>;
  underlying?: Record<string, `0x${string}`>;
};

const map: Record<number, Deployment> = {
  31337: local as Deployment,
  421614: arbSepolia as Deployment,
};

export function getDeployment(chainId: number): Deployment {
  const d = map[chainId];
  if (!d) throw new Error(`No deployment for chainId ${chainId}`);
  return d;
}
