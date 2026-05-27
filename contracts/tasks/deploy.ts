import { ethers, network, run } from "hardhat";
import { writeDeployment } from "./lib/write-deployment";

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = process.env.ADMIN_ADDRESS ?? deployer.address;
  const matcher = process.env.MATCHER_ADDRESS ?? deployer.address;
  const fee = process.env.FEE_COLLECTOR_ADDRESS ?? deployer.address;

  console.log("deploying on", network.name, "as", deployer.address);

  const Token = await ethers.getContractFactory("TestERC20");
  const usdc = await Token.deploy("Mock USDC", "mUSDC", 6); await usdc.waitForDeployment();
  const weth = await Token.deploy("Mock WETH", "mWETH", 18); await weth.waitForDeployment();
  const wbtc = await Token.deploy("Mock WBTC", "mWBTC", 8); await wbtc.waitForDeployment();

  const Wrapper = await ethers.getContractFactory("FHERC20Wrapper");
  const eUSDC = await Wrapper.deploy(await usdc.getAddress(), "eUSDC", "eUSDC", 6); await eUSDC.waitForDeployment();
  const eWETH = await Wrapper.deploy(await weth.getAddress(), "eWETH", "eWETH", 18); await eWETH.waitForDeployment();
  const eWBTC = await Wrapper.deploy(await wbtc.getAddress(), "eWBTC", "eWBTC", 8); await eWBTC.waitForDeployment();

  const Dex = await ethers.getContractFactory("DarkPoolDEX");
  const dex = await Dex.deploy(admin, matcher, fee); await dex.waitForDeployment();

  await (await dex.registerPair(await eUSDC.getAddress(), await eWETH.getAddress(), 10n * 10n ** 6n)).wait();
  await (await dex.registerPair(await eUSDC.getAddress(), await eWBTC.getAddress(), 10n * 10n ** 6n)).wait();

  await (await dex.setBatchDuration(5 * 60)).wait();
  await (await dex.setDisputeWindow(30 * 60)).wait();
  await (await dex.setFeeRate(20)).wait();

  const deployment = {
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    dex: await dex.getAddress(),
    admin, matcher, feeCollector: fee,
    pairs: [
      { id: 0, base: { address: await eUSDC.getAddress(), symbol: "eUSDC", decimals: 6 }, quote: { address: await eWETH.getAddress(), symbol: "eWETH", decimals: 18 } },
      { id: 1, base: { address: await eUSDC.getAddress(), symbol: "eUSDC", decimals: 6 }, quote: { address: await eWBTC.getAddress(), symbol: "eWBTC", decimals: 8 } },
    ],
    underlying: {
      mUSDC: await usdc.getAddress(),
      mWETH: await weth.getAddress(),
      mWBTC: await wbtc.getAddress(),
    },
  };
  await writeDeployment(network.name, deployment);

  if (network.name === "arbSepolia" && process.env.ETHERSCAN_API_KEY) {
    console.log("waiting 30s before verify...");
    await new Promise((r) => setTimeout(r, 30000));
    try { await run("verify:verify", { address: await dex.getAddress(), constructorArguments: [admin, matcher, fee] }); console.log("verified DarkPoolDEX"); }
    catch (e) { console.warn("verify failed DarkPoolDEX", (e as Error).message); }
  }

  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });
