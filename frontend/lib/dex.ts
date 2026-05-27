import { useReadContract } from "wagmi";
import abi from "./generated/DarkPoolDEX.json";
import deployedJson from "./generated/deployed-arbSepolia.json";
import { arbitrumSepolia } from "wagmi/chains";

export type Deployment = typeof deployedJson;

export const dexAbi = (abi as any).abi;

export function deployment(): Deployment {
  return deployedJson as Deployment;
}

export function useMatcher() {
  const dep = deployment();
  return useReadContract({
    abi: dexAbi,
    address: dep.dex as `0x${string}`,
    chainId: arbitrumSepolia.id,
    functionName: "matcher",
  });
}
