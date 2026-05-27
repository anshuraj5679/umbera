import fs from "node:fs/promises";
import path from "node:path";
import { ethers, network } from "hardhat";
import { writeDeployment } from "./lib/write-deployment";

type TokenInfo = {
  address: string;
  symbol: string;
  decimals: number;
};

type Deployment = {
  chainId: number;
  deployedAt: string;
  updatedAt?: string;
  dex: string;
  admin: string;
  matcher: string;
  feeCollector: string;
  pairs: Array<{
    id: number;
    base: TokenInfo;
    quote: TokenInfo;
  }>;
  underlying: Record<string, string>;
};

const MIN_ORDER_USDC = 10n * 10n ** 6n;

const MARKET_SPECS = [
  {
    underlyingKey: "mARB",
    underlyingName: "Mock ARB",
    wrapperName: "eARB",
    wrapperSymbol: "eARB",
    decimals: 18,
  },
  {
    underlyingKey: "mLINK",
    underlyingName: "Mock LINK",
    wrapperName: "eLINK",
    wrapperSymbol: "eLINK",
    decimals: 18,
  },
] as const;

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer signer configured");

  const deployment = await readDeployment(network.name);
  const eUSDC = deployment.pairs[0]?.base;
  if (!eUSDC || eUSDC.symbol !== "eUSDC") {
    throw new Error("Deployment file must contain eUSDC as pair 0 base token");
  }

  const Dex = await ethers.getContractFactory("DarkPoolDEX");
  const Token = await ethers.getContractFactory("TestERC20");
  const Wrapper = await ethers.getContractFactory("FHERC20Wrapper");
  const dex = Dex.attach(deployment.dex);

  const admin = await dex.admin();
  if (admin.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Deployer ${deployer.address} is not DEX admin ${admin}`);
  }

  console.log("adding demo markets on", network.name, "as", deployer.address);
  console.log("dex", deployment.dex);

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== deployment.chainId) {
    throw new Error(`Connected chain ${chainId} does not match deployment chain ${deployment.chainId}`);
  }

  for (const spec of MARKET_SPECS) {
    let underlying = deployment.underlying[spec.underlyingKey];
    const existingPair = deployment.pairs.find((pair) => pair.quote.symbol === spec.wrapperSymbol);
    let wrapper = existingPair?.quote.address;

    if (!underlying) {
      const token = await Token.deploy(spec.underlyingName, spec.underlyingKey, spec.decimals);
      await token.waitForDeployment();
      underlying = await token.getAddress();
      deployment.underlying[spec.underlyingKey] = underlying;
      console.log(`${spec.underlyingKey}`, underlying);
    } else {
      console.log(`${spec.underlyingKey} existing`, underlying);
    }

    if (!wrapper) {
      const encrypted = await Wrapper.deploy(underlying, spec.wrapperName, spec.wrapperSymbol, spec.decimals);
      await encrypted.waitForDeployment();
      wrapper = await encrypted.getAddress();
      console.log(`${spec.wrapperSymbol}`, wrapper);
    } else {
      console.log(`${spec.wrapperSymbol} existing`, wrapper);
    }

    if (existingPair) {
      await assertPair(dex, existingPair.id, eUSDC.address, wrapper, spec.wrapperSymbol);
      continue;
    }

    const pairId = Number(await dex.nextPairId());
    const tx = await dex.registerPair(eUSDC.address, wrapper, MIN_ORDER_USDC);
    console.log(`register ${eUSDC.symbol}/${spec.wrapperSymbol} pair #${pairId}:`, tx.hash);
    await tx.wait();
    await assertPair(dex, pairId, eUSDC.address, wrapper, spec.wrapperSymbol);

    deployment.pairs.push({
      id: pairId,
      base: eUSDC,
      quote: {
        address: wrapper,
        symbol: spec.wrapperSymbol,
        decimals: spec.decimals,
      },
    });
  }

  deployment.updatedAt = new Date().toISOString();
  deployment.pairs.sort((a, b) => a.id - b.id);
  await writeDeployment(network.name, deployment);
  console.log("done");
}

async function readDeployment(networkName: string): Promise<Deployment> {
  const filename = networkName === "hardhat" || networkName === "localhost"
    ? ".deployed-local.json"
    : `.deployed-${networkName}.json`;
  const file = path.resolve(__dirname, "../../shared/addresses", filename);
  return JSON.parse(await fs.readFile(file, "utf8")) as Deployment;
}

async function assertPair(dex: any, pairId: number, base: string, quote: string, quoteSymbol: string) {
  const pair = await dex.pairs(pairId);
  if (pair.baseToken.toLowerCase() !== base.toLowerCase() || pair.quoteToken.toLowerCase() !== quote.toLowerCase()) {
    throw new Error(`On-chain pair #${pairId} does not match expected eUSDC/${quoteSymbol}`);
  }
  if (!pair.active) {
    throw new Error(`On-chain pair #${pairId} eUSDC/${quoteSymbol} is not active`);
  }
  console.log(`verified pair #${pairId} eUSDC/${quoteSymbol}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
