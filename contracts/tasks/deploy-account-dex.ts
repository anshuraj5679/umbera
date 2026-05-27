import fs from "node:fs/promises";
import path from "node:path";
import { ethers, network, run } from "hardhat";
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
  pairs: Array<{ id: number; base: TokenInfo; quote: TokenInfo }>;
  underlying: Record<string, string>;
  previousDex?: string;
  previousDeployment?: unknown;
};

const MIN_ORDER_USDC = 10n * 10n ** 6n;
const BATCH_DURATION_SEC = 5 * 60;
const DISPUTE_WINDOW_SEC = 5 * 60;
const FEE_BPS = 20;

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer signer configured");

  const previous = await readDeployment(network.name);
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== previous.chainId) {
    throw new Error(`Connected chain ${chainId} does not match deployment chain ${previous.chainId}`);
  }

  const admin = process.env.ADMIN_ADDRESS ?? previous.admin ?? deployer.address;
  const matcher = process.env.MATCHER_ADDRESS ?? previous.matcher ?? deployer.address;
  const feeCollector = process.env.FEE_COLLECTOR_ADDRESS ?? previous.feeCollector ?? deployer.address;

  console.log("deploying account-commitment DEX on", network.name, "as", deployer.address);
  console.log("previous dex", previous.dex);
  console.log("admin", admin);
  console.log("matcher", matcher);
  console.log("feeCollector", feeCollector);

  const Dex = await ethers.getContractFactory("DarkPoolDEX");
  const dex = await Dex.deploy(admin, matcher, feeCollector);
  await dex.waitForDeployment();
  const dexAddress = await dex.getAddress();
  console.log("new dex", dexAddress);

  const registeredPairs: Deployment["pairs"] = [];
  for (const pair of previous.pairs) {
    const expectedPairId = Number(await dex.nextPairId());
    if (expectedPairId !== pair.id) {
      throw new Error(`Expected next pair id ${pair.id}, got ${expectedPairId}`);
    }
    const tx = await dex.registerPair(pair.base.address, pair.quote.address, MIN_ORDER_USDC);
    console.log(`register pair #${pair.id} ${pair.base.symbol}/${pair.quote.symbol}:`, tx.hash);
    await tx.wait();
    await assertPair(dex, pair.id, pair);
    registeredPairs.push(pair);
  }

  await (await dex.setBatchDuration(BATCH_DURATION_SEC)).wait();
  await (await dex.setDisputeWindow(DISPUTE_WINDOW_SEC)).wait();
  await (await dex.setFeeRate(FEE_BPS)).wait();

  const deployment: Deployment = {
    ...previous,
    chainId,
    deployedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    previousDex: previous.dex,
    previousDeployment: {
      dex: previous.dex,
      deployedAt: previous.deployedAt,
      updatedAt: previous.updatedAt,
      pairs: previous.pairs,
    },
    dex: dexAddress,
    admin,
    matcher,
    feeCollector,
    pairs: registeredPairs,
    underlying: previous.underlying,
  };
  await writeDeployment(network.name, deployment);

  if (network.name === "arbSepolia" && process.env.ETHERSCAN_API_KEY) {
    console.log("waiting 30s before verify...");
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    try {
      await run("verify:verify", { address: dexAddress, constructorArguments: [admin, matcher, feeCollector] });
      console.log("verified DarkPoolDEX");
    } catch (error) {
      console.warn("verify failed DarkPoolDEX", error instanceof Error ? error.message : String(error));
    }
  }

  console.log("done");
}

async function readDeployment(networkName: string): Promise<Deployment> {
  const filename = networkName === "hardhat" || networkName === "localhost"
    ? ".deployed-local.json"
    : `.deployed-${networkName}.json`;
  const file = path.resolve(__dirname, "../../shared/addresses", filename);
  return JSON.parse(await fs.readFile(file, "utf8")) as Deployment;
}

async function assertPair(dex: any, pairId: number, pair: Deployment["pairs"][number]) {
  const onChain = await dex.pairs(pairId);
  if (
    onChain.baseToken.toLowerCase() !== pair.base.address.toLowerCase() ||
    onChain.quoteToken.toLowerCase() !== pair.quote.address.toLowerCase() ||
    !onChain.active
  ) {
    throw new Error(`Pair #${pairId} registration mismatch`);
  }
  console.log(`verified pair #${pairId} ${pair.base.symbol}/${pair.quote.symbol}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
