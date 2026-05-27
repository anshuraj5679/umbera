import "@nomicfoundation/hardhat-toolbox";
// hardhat-foundry is loaded only when forge is on PATH (CI). Local Windows boxes typically lack it.
try { require("@nomicfoundation/hardhat-foundry"); } catch { /* forge missing locally */ }
import "@nomicfoundation/hardhat-verify";
import "cofhe-hardhat-plugin";
import * as dotenv from "dotenv";
dotenv.config({ path: "../.env" });

import type { HardhatUserConfig } from "hardhat/config";

const ARB_SEPOLIA_RPC = process.env.ARB_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";
const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.25",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
  networks: {
    hardhat: {
      chainId: 31337,
      // Pin to cancun to avoid Osaka's native P256 precompile at 0x100,
      // which conflicts with the cofhe-hardhat-plugin's MockZkVerifier address.
      hardfork: "cancun",
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    arbSepolia: {
      url: ARB_SEPOLIA_RPC,
      chainId: 421614,
      accounts: DEPLOYER_PK ? [DEPLOYER_PK] : [],
    },
    ...(process.env.MAINNET === "true" && process.env.ARB_MAINNET_RPC_URL && DEPLOYER_PK
      ? {
          arbMainnet: {
            url: process.env.ARB_MAINNET_RPC_URL,
            chainId: 42161,
            accounts: [DEPLOYER_PK],
          },
        }
      : {}),
  },
  etherscan: {
    apiKey: {
      arbitrumSepolia: process.env.ETHERSCAN_API_KEY ?? "",
    },
  },
};

export default config;
