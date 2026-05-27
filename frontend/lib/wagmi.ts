import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { arbitrumSepolia } from "wagmi/chains";

export const wagmiConfig = getDefaultConfig({
  appName: "Dark Pool DEX",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_ID!,
  chains: [arbitrumSepolia],
  ssr: true,
});
