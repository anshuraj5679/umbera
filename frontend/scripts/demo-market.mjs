import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { runAuction } from "../../shared/auction/auction.js";

const DEX_ABI_PATH = "shared/abi/DarkPoolDEX.json";
const WRAPPER_ABI_PATH = "shared/abi/FHERC20Wrapper.json";
const DEPLOYMENT_PATH = "shared/addresses/.deployed-arbSepolia.json";
const DEPLOY_BLOCK = 269_080_000n;

const erc20Abi = parseAbi([
  "function mint(address to,uint256 amount)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
]);

const demoOrders = [
  { label: "maker sell WETH @ 3150", pairId: 0, side: "SELL", assetAmount: "0.75", priceCashPerAsset: "3150" },
  { label: "maker sell WETH @ 3200", pairId: 0, side: "SELL", assetAmount: "0.50", priceCashPerAsset: "3200" },
  { label: "maker buy WETH @ 3250", pairId: 0, side: "BUY", assetAmount: "0.25", priceCashPerAsset: "3250" },
  { label: "maker sell WBTC @ 65000", pairId: 1, side: "SELL", assetAmount: "0.05", priceCashPerAsset: "65000" },
  { label: "maker buy WBTC @ 66000", pairId: 1, side: "BUY", assetAmount: "0.03", priceCashPerAsset: "66000" },
  { label: "maker sell ARB @ 1.15", pairId: 2, side: "SELL", assetAmount: "2500", priceCashPerAsset: "1.15" },
  { label: "maker buy ARB @ 1.20", pairId: 2, side: "BUY", assetAmount: "1000", priceCashPerAsset: "1.20" },
  { label: "maker sell LINK @ 18.50", pairId: 3, side: "SELL", assetAmount: "120", priceCashPerAsset: "18.50" },
  { label: "maker buy LINK @ 19.00", pairId: 3, side: "BUY", assetAmount: "80", priceCashPerAsset: "19.00" },
];

const wrapBudget = {
  mUSDC: "50000",
  mWETH: "3",
  mWBTC: "0.2",
  mARB: "5000",
  mLINK: "500",
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, "..");
const root = path.resolve(frontendDir, "..");

async function main() {
  const command = process.argv[2] ?? "seed";
  const flags = new Set(process.argv.slice(3));
  const ctx = await makeCtx({
    needsWallet: command !== "status",
    needsCofhe: command === "seed" || command === "orders" || command === "match",
  });

  if (command === "status") {
    await printStatus(ctx);
    return;
  }

  if (command === "configure") {
    await configureDemoWindows(ctx);
    return;
  }

  if (command === "close") {
    await closeCurrentBatch(ctx);
    return;
  }

  if (command === "match") {
    const batchId = process.argv[3] ? BigInt(process.argv[3]) : await lastClosedBatch(ctx);
    await matchBatch(ctx, batchId);
    return;
  }

  if (command === "settle") {
    const fromMatchId = process.argv[3] ? BigInt(process.argv[3]) : 0n;
    const toMatchId = process.argv[4] ? BigInt(process.argv[4]) : undefined;
    await settleMatches(ctx, fromMatchId, toMatchId);
    return;
  }

  if (command === "orders") {
    if (flags.has("--fresh-empty")) await closeEmptyBatchIfReady(ctx);
    await warnIfBatchCloseReady(ctx);
    await approveOperators(ctx);
    await seedOrders(ctx);
    if (flags.has("--close")) await closeCurrentBatch(ctx);
    await printStatus(ctx);
    return;
  }

  if (command !== "seed") {
    throw new Error(`Unknown command "${command}". Use: seed, orders, status, configure, close, match, settle.`);
  }

  if (flags.has("--configure")) await configureDemoWindows(ctx);
  await warnIfBatchCloseReady(ctx);
  await prepareBalances(ctx);
  await approveOperators(ctx);
  await seedOrders(ctx);
  if (flags.has("--close")) await closeCurrentBatch(ctx);
  await printStatus(ctx);
}

async function makeCtx({ needsWallet, needsCofhe }) {
  const env = {
    ...readEnvFile(path.resolve(root, ".env")),
    ...readEnvFile(path.resolve(frontendDir, ".env.local")),
    ...process.env,
  };
  const rpc = env.ARB_SEPOLIA_RPC_URL ?? env.NEXT_PUBLIC_ARB_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";
  const deployment = readJson(DEPLOYMENT_PATH);
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });

  let account;
  let walletClient;
  let cofhe;
  let Encryptable;

  if (needsWallet) {
    const privateKey = env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY missing in .env or frontend/.env.local");
    account = privateKeyToAccount(privateKey);
    walletClient = createWalletClient({ chain: arbitrumSepolia, transport: http(rpc), account });
    console.log(`demo wallet ${account.address}`);
  }

  if (needsCofhe) {
    if (!walletClient) throw new Error("CoFHE encryption requires DEPLOYER_PRIVATE_KEY");
    installMemoryLocalStorage();
    const [nodeSdk, sdk, chains] = await Promise.all([
      import("@cofhe/sdk/node"),
      import("@cofhe/sdk"),
      import("@cofhe/sdk/chains"),
    ]);
    Encryptable = sdk.Encryptable;
    const FheTypes = sdk.FheTypes;
    cofhe = nodeSdk.createCofheClient(nodeSdk.createCofheConfig({ supportedChains: [chains.arbSepolia] }));
    await cofhe.connect(publicClient, walletClient);
    await cofhe.permits.getOrCreateSelfPermit(arbitrumSepolia.id, account.address, {
      issuer: account.address,
      name: "Obsidian CLI Matcher",
    });
    console.log(`dex ${deployment.dex}`);
    return { env, deployment, publicClient, walletClient, cofhe, Encryptable, FheTypes, account };
  }

  console.log(`dex ${deployment.dex}`);
  return { env, deployment, publicClient, walletClient, cofhe, Encryptable, account };
}

async function configureDemoWindows(ctx) {
  const dexAbi = readArtifactAbi(DEX_ABI_PATH);
  const targetDuration = BigInt(readPositiveIntEnv(ctx.env.DEMO_BATCH_DURATION_SEC, 300, "DEMO_BATCH_DURATION_SEC"));
  const targetDisputeWindow = BigInt(readPositiveIntEnv(ctx.env.DEMO_DISPUTE_WINDOW_SEC, 300, "DEMO_DISPUTE_WINDOW_SEC"));
  const duration = await ctx.publicClient.readContract({
    address: ctx.deployment.dex,
    abi: dexAbi,
    functionName: "batchDuration",
  });
  const disputeWindow = await ctx.publicClient.readContract({
    address: ctx.deployment.dex,
    abi: dexAbi,
    functionName: "disputeWindow",
  });

  if (duration !== targetDuration) {
    await write(ctx, `set batch duration ${targetDuration}s`, {
      address: ctx.deployment.dex,
      abi: dexAbi,
      functionName: "setBatchDuration",
      args: [targetDuration],
      gas: 180_000n,
    });
  }
  if (disputeWindow !== targetDisputeWindow) {
    await write(ctx, `set dispute window ${targetDisputeWindow}s`, {
      address: ctx.deployment.dex,
      abi: dexAbi,
      functionName: "setDisputeWindow",
      args: [targetDisputeWindow],
      gas: 180_000n,
    });
  }
}

async function prepareBalances(ctx) {
  const wrapperAbi = readArtifactAbi(WRAPPER_ABI_PATH);
  const rows = tokenRows(ctx.deployment);

  for (const row of rows) {
    const underlying = ctx.deployment.underlying[row.key];
    const budget = wrapBudget[row.key];
    if (!budget) throw new Error(`missing wrap budget for ${row.key}`);
    const amount = toUnits(budget, row.decimals);
    await write(ctx, `mint ${wrapBudget[row.key]} ${row.key}`, {
      address: underlying,
      abi: erc20Abi,
      functionName: "mint",
      args: [ctx.account.address, amount],
      gas: 250_000n,
    });

    const allowance = await ctx.publicClient.readContract({
      address: underlying,
      abi: erc20Abi,
      functionName: "allowance",
      args: [ctx.account.address, row.wrapper],
    });
    if (allowance < amount) {
      await write(ctx, `approve ${row.key} wrapper`, {
        address: underlying,
        abi: erc20Abi,
        functionName: "approve",
        args: [row.wrapper, amount],
        gas: 250_000n,
      });
    }

    await write(ctx, `wrap ${wrapBudget[row.key]} ${row.key}`, {
      address: row.wrapper,
      abi: wrapperAbi,
      functionName: "wrap",
      args: [amount],
      gas: 2_000_000n,
    });
  }
}

async function approveOperators(ctx) {
  const wrapperAbi = readArtifactAbi(WRAPPER_ABI_PATH);
  const wrappers = tokenRows(ctx.deployment).map((row) => row.wrapper);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);

  for (const wrapper of wrappers) {
    const active = await ctx.publicClient.readContract({
      address: wrapper,
      abi: wrapperAbi,
      functionName: "isOperator",
      args: [ctx.account.address, ctx.deployment.dex],
    });
    if (active) continue;
    await write(ctx, `approve operator ${wrapper}`, {
      address: wrapper,
      abi: wrapperAbi,
      functionName: "setOperator",
      args: [ctx.deployment.dex, deadline],
      gas: 250_000n,
    });
  }
}

async function seedOrders(ctx) {
  if (!ctx.cofhe || !ctx.Encryptable) throw new Error("CoFHE client unavailable for seed orders");
  const dexAbi = readArtifactAbi(DEX_ABI_PATH);
  for (const plan of demoOrders) {
    const pair = ctx.deployment.pairs.find((entry) => entry.id === plan.pairId);
    if (!pair) throw new Error(`unknown pair ${plan.pairId}`);

    const assetRaw = toUnits(plan.assetAmount, pair.quote.decimals);
    const priceRaw = toUnits(plan.priceCashPerAsset, pair.base.decimals);
    const cashRaw = computeCashAmount(assetRaw, priceRaw, pair.quote.decimals);
    const baseDepositRaw = plan.side === "BUY" ? cashRaw : 0n;
    const quoteDepositRaw = plan.side === "SELL" ? assetRaw : 0n;
    const baseRequestRaw = plan.side === "SELL" ? cashRaw : 0n;
    const quoteRequestRaw = plan.side === "BUY" ? assetRaw : 0n;
    const [encBaseDeposit, encQuoteDeposit, encBaseRequest, encQuoteRequest] = await ctx.cofhe.encryptInputs([
      ctx.Encryptable.uint128(baseDepositRaw),
      ctx.Encryptable.uint128(quoteDepositRaw),
      ctx.Encryptable.uint128(baseRequestRaw),
      ctx.Encryptable.uint128(quoteRequestRaw),
    ]).execute();
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 24 * 3600);

    await write(ctx, `submit ${plan.label}`, {
      address: ctx.deployment.dex,
      abi: dexAbi,
      functionName: "submitOrder",
      args: [BigInt(plan.pairId), encBaseDeposit, encQuoteDeposit, encBaseRequest, encQuoteRequest, expiry],
      gas: 8_000_000n,
    });
  }
}

async function matchBatch(ctx, batchId) {
  if (!ctx.cofhe || !ctx.Encryptable || !ctx.FheTypes || !ctx.account) {
    throw new Error("match requires DEPLOYER_PRIVATE_KEY and CoFHE");
  }
  const dexAbi = readArtifactAbi(DEX_ABI_PATH);
  const matcher = await ctx.publicClient.readContract({
    address: ctx.deployment.dex,
    abi: dexAbi,
    functionName: "matcher",
  });
  if (matcher.toLowerCase() !== ctx.account.address.toLowerCase()) {
    throw new Error(`DEPLOYER_PRIVATE_KEY wallet ${ctx.account.address} is not the on-chain matcher ${matcher}`);
  }

  const orders = await fetchOrdersInBatch(ctx, batchId);
  const active = orders.filter((order) => order.status === 0);
  console.log(`batch #${batchId}: ${orders.length} submitted, ${active.length} active`);

  const decrypted = [];
  for (const order of active) {
    const [baseDeposit, quoteDeposit, baseRequest, quoteRequest] = await Promise.all([
      decryptUint128(ctx, order.baseDepositHandle),
      decryptUint128(ctx, order.quoteDepositHandle),
      decryptUint128(ctx, order.baseRequestHandle),
      decryptUint128(ctx, order.quoteRequestHandle),
    ]);
    const pair = ctx.deployment.pairs[order.pairId];
    if (!pair) throw new Error(`unknown pair ${order.pairId}`);
    const auctionOrder = classifyPrivateOrder({
      orderId: order.orderId,
      baseDeposit,
      quoteDeposit,
      baseRequest,
      quoteRequest,
      pair,
    });
    if (!auctionOrder) {
      console.log(`order #${order.orderId} has invalid private legs; skipping`);
      continue;
    }
    decrypted.push({
      ...order,
      baseDeposit,
      quoteDeposit,
      baseRequest,
      quoteRequest,
      auctionOrder,
    });
  }

  const allMatches = [];
  for (const pair of ctx.deployment.pairs) {
    const pairOrders = decrypted.filter((order) => order.pairId === pair.id).map((order) => order.auctionOrder);
    const result = runAuction(pairOrders);
    console.log(`pair #${pair.id} ${pair.base.symbol}/${pair.quote.symbol}: ${pairOrders.length} orders, ${result.matches.length} matches, clearing ${result.clearingPriceQuotePerBase}`);
    allMatches.push(...result.matches);
  }

  if (allMatches.length === 0) {
    console.log("no crossing orders to publish");
    return;
  }

  const orderAIds = [];
  const orderBIds = [];
  const baseToAs = [];
  const quoteToAs = [];
  const baseToBs = [];
  const quoteToBs = [];
  for (const match of allMatches) {
    const flow = privateMatchFlow(match);
    orderAIds.push(flow.orderAId);
    orderBIds.push(flow.orderBId);
    const [baseToA, quoteToA, baseToB, quoteToB] = await ctx.cofhe.encryptInputs([
      ctx.Encryptable.uint128(flow.baseToA),
      ctx.Encryptable.uint128(flow.quoteToA),
      ctx.Encryptable.uint128(flow.baseToB),
      ctx.Encryptable.uint128(flow.quoteToB),
    ]).execute();
    baseToAs.push(baseToA);
    quoteToAs.push(quoteToA);
    baseToBs.push(baseToB);
    quoteToBs.push(quoteToB);
  }

  await write(ctx, `publish ${allMatches.length} matches for batch #${batchId}`, {
    address: ctx.deployment.dex,
    abi: dexAbi,
    functionName: "publishMatches",
    args: [orderAIds, orderBIds, baseToAs, quoteToAs, baseToBs, quoteToBs],
    gas: 12_000_000n,
  });
  await printStatus(ctx);
}

async function settleMatches(ctx, fromMatchId, toMatchIdArg) {
  const dexAbi = readArtifactAbi(DEX_ABI_PATH);
  const [nextMatchId, disputeWindow] = await Promise.all([
    ctx.publicClient.readContract({ address: ctx.deployment.dex, abi: dexAbi, functionName: "nextMatchId" }),
    ctx.publicClient.readContract({ address: ctx.deployment.dex, abi: dexAbi, functionName: "disputeWindow" }),
  ]);
  const toMatchId = toMatchIdArg ?? nextMatchId;
  const block = await ctx.publicClient.getBlock({ blockTag: "latest" });
  const now = block.timestamp;
  let settled = 0;

  for (let matchId = fromMatchId; matchId < toMatchId; matchId++) {
    const info = await ctx.publicClient.readContract({
      address: ctx.deployment.dex,
      abi: dexAbi,
      functionName: "getMatchInfo",
      args: [matchId],
    });
    const publishedAt = info[3];
    const status = Number(info[4]);
    if (status !== 0) {
      console.log(`match #${matchId} skipped: status ${status}`);
      continue;
    }
    const readyAt = publishedAt + disputeWindow;
    if (now < readyAt) {
      console.log(`match #${matchId} not settleable yet; ${readyAt - now}s remaining`);
      continue;
    }
    try {
      await ctx.publicClient.simulateContract({
        account: ctx.account,
        address: ctx.deployment.dex,
        abi: dexAbi,
        functionName: "settleMatch",
        args: [matchId],
      });
    } catch (error) {
      console.log(`match #${matchId} simulation rejected: ${formatTxError(error)}`);
      continue;
    }
    await write(ctx, `settle match #${matchId}`, {
      address: ctx.deployment.dex,
      abi: dexAbi,
      functionName: "settleMatch",
      args: [matchId],
      gas: 2_500_000n,
    });
    settled++;
  }

  console.log(`settled ${settled} matches`);
  await printStatus(ctx);
}

async function fetchOrdersInBatch(ctx, batchId) {
  const dexAbi = readArtifactAbi(DEX_ABI_PATH);
  const submittedEvent = dexAbi.find((entry) => entry.type === "event" && entry.name === "OrderSubmitted");
  if (!submittedEvent) throw new Error("OrderSubmitted abi missing");

  const logs = await ctx.publicClient.getLogs({
    address: ctx.deployment.dex,
    event: submittedEvent,
    args: { batchId },
    fromBlock: DEPLOY_BLOCK,
    toBlock: "latest",
  });

  const out = [];
  for (const log of logs) {
    const orderId = log.args.orderId;
    const [info, legs] = await Promise.all([
      ctx.publicClient.readContract({ address: ctx.deployment.dex, abi: dexAbi, functionName: "getOrderInfo", args: [orderId] }),
      ctx.publicClient.readContract({ address: ctx.deployment.dex, abi: dexAbi, functionName: "getOrderLegs", args: [orderId] }),
    ]);
    out.push({
      orderId,
      trader: info[0],
      pairId: Number(info[1]),
      status: Number(info[5]),
      baseDepositHandle: legs[0],
      quoteDepositHandle: legs[1],
      baseRequestHandle: legs[2],
      quoteRequestHandle: legs[3],
    });
  }
  return out;
}

function classifyPrivateOrder({ orderId, baseDeposit, quoteDeposit, baseRequest, quoteRequest, pair }) {
  if (baseDeposit > 0n && quoteRequest > 0n && quoteDeposit === 0n && baseRequest === 0n) {
    return {
      id: orderId,
      side: "BUY",
      remainingDeposit: baseDeposit,
      remainingRequest: quoteRequest,
      cashDecimals: pair.base.decimals,
      assetDecimals: pair.quote.decimals,
    };
  }
  if (quoteDeposit > 0n && baseRequest > 0n && baseDeposit === 0n && quoteRequest === 0n) {
    return {
      id: orderId,
      side: "SELL",
      remainingDeposit: quoteDeposit,
      remainingRequest: baseRequest,
      cashDecimals: pair.base.decimals,
      assetDecimals: pair.quote.decimals,
    };
  }
  return null;
}

function privateMatchFlow(match) {
  if (match.buyOrderId < match.sellOrderId) {
    return {
      orderAId: match.buyOrderId,
      orderBId: match.sellOrderId,
      baseToA: 0n,
      quoteToA: match.assetAmount,
      baseToB: match.cashAmount,
      quoteToB: 0n,
    };
  }
  return {
    orderAId: match.sellOrderId,
    orderBId: match.buyOrderId,
    baseToA: match.cashAmount,
    quoteToA: 0n,
    baseToB: 0n,
    quoteToB: match.assetAmount,
  };
}

async function decryptUint128(ctx, handle) {
  const value = await ctx.cofhe.decryptForView(handle, ctx.FheTypes.Uint128).execute();
  return BigInt(value);
}

async function closeCurrentBatch(ctx) {
  const dexAbi = readArtifactAbi(DEX_ABI_PATH);
  const cur = await ctx.publicClient.readContract({
    address: ctx.deployment.dex,
    abi: dexAbi,
    functionName: "getCurrentBatch",
  });
  const duration = await ctx.publicClient.readContract({
    address: ctx.deployment.dex,
    abi: dexAbi,
    functionName: "batchDuration",
  });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const closesAt = cur[1] + duration;
  if (!cur[2]) {
    console.log(`batch #${cur[0]} already closed`);
    return;
  }
  if (now < closesAt) {
    console.log(`batch #${cur[0]} not closeable yet; ${closesAt - now}s remaining`);
    return;
  }
  await write(ctx, `close batch #${cur[0]}`, {
    address: ctx.deployment.dex,
    abi: dexAbi,
    functionName: "closeBatch",
    args: [],
    gas: 300_000n,
  });
}

async function closeEmptyBatchIfReady(ctx) {
  const dexAbi = readArtifactAbi(DEX_ABI_PATH);
  const cur = await ctx.publicClient.readContract({
    address: ctx.deployment.dex,
    abi: dexAbi,
    functionName: "getCurrentBatch",
  });
  const duration = await ctx.publicClient.readContract({
    address: ctx.deployment.dex,
    abi: dexAbi,
    functionName: "batchDuration",
  });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const closesAt = cur[1] + duration;

  if (!cur[2]) {
    console.log(`batch #${cur[0]} already closed`);
    return;
  }
  if (cur[3] !== 0n) {
    console.log(`batch #${cur[0]} has ${cur[3]} orders; leaving it for the daemon`);
    return;
  }
  if (now < closesAt) {
    console.log(`empty batch #${cur[0]} not closeable yet; ${closesAt - now}s remaining`);
    return;
  }

  await write(ctx, `close empty batch #${cur[0]}`, {
    address: ctx.deployment.dex,
    abi: dexAbi,
    functionName: "closeBatch",
    args: [],
    gas: 300_000n,
  });
}

async function lastClosedBatch(ctx) {
  const dexAbi = readArtifactAbi(DEX_ABI_PATH);
  const cur = await ctx.publicClient.readContract({
    address: ctx.deployment.dex,
    abi: dexAbi,
    functionName: "getCurrentBatch",
  });
  if (cur[0] === 0n) throw new Error("no closed batches yet");
  return cur[0] - 1n;
}

async function warnIfBatchCloseReady(ctx) {
  const dexAbi = readArtifactAbi(DEX_ABI_PATH);
  const cur = await ctx.publicClient.readContract({
    address: ctx.deployment.dex,
    abi: dexAbi,
    functionName: "getCurrentBatch",
  });
  const duration = await ctx.publicClient.readContract({
    address: ctx.deployment.dex,
    abi: dexAbi,
    functionName: "batchDuration",
  });
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (cur[2] && now >= cur[1] + duration) {
    console.log(`batch #${cur[0]} timer has elapsed but is still open on-chain; seed orders will join this batch until closeBatch runs`);
  }
}

async function printStatus(ctx) {
  const dexAbi = readArtifactAbi(DEX_ABI_PATH);
  const [cur, duration, nextOrderId, nextMatchId] = await Promise.all([
    ctx.publicClient.readContract({ address: ctx.deployment.dex, abi: dexAbi, functionName: "getCurrentBatch" }),
    ctx.publicClient.readContract({ address: ctx.deployment.dex, abi: dexAbi, functionName: "batchDuration" }),
    ctx.publicClient.readContract({ address: ctx.deployment.dex, abi: dexAbi, functionName: "nextOrderId" }),
    ctx.publicClient.readContract({ address: ctx.deployment.dex, abi: dexAbi, functionName: "nextMatchId" }),
  ]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const remaining = cur[2] && now < cur[1] + duration ? cur[1] + duration - now : 0n;
  const closeable = cur[2] && remaining === 0n;
  console.log(JSON.stringify({
    batchId: cur[0].toString(),
    batchOpen: cur[2],
    closeable,
    currentBatchOrders: cur[3].toString(),
    secondsUntilClose: remaining.toString(),
    nextOrderId: nextOrderId.toString(),
    nextMatchId: nextMatchId.toString(),
  }, null, 2));
}

async function write(ctx, label, request) {
  if (!ctx.walletClient || !ctx.account) throw new Error(`${label} requires DEPLOYER_PRIVATE_KEY`);
  const fees = await txFees(ctx.publicClient);
  const hash = await ctx.walletClient.writeContract({
    account: ctx.account,
    chain: arbitrumSepolia,
    address: request.address,
    abi: request.abi,
    functionName: request.functionName,
    args: request.args,
    gas: request.gas,
    ...fees,
  });
  console.log(`${label}: ${hash}`);
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  return receipt;
}

async function txFees(publicClient) {
  try {
    const [block, estimate] = await Promise.all([
      publicClient.getBlock({ blockTag: "latest" }),
      publicClient.estimateFeesPerGas().catch(() => null),
    ]);
    const baseFee = block.baseFeePerGas ?? 0n;
    const estimatedMax = estimate?.maxFeePerGas ?? 0n;
    const priority = maxBigint(estimate?.maxPriorityFeePerGas ?? 0n, 100_000n);
    return {
      maxFeePerGas: maxBigint(baseFee + baseFee / 2n + priority, estimatedMax + estimatedMax / 2n),
      maxPriorityFeePerGas: priority,
    };
  } catch {
    return {};
  }
}

function readArtifactAbi(relPath) {
  return readJson(relPath).abi;
}

function tokenRows(deployment) {
  const rows = [];
  const seen = new Set();
  for (const pair of deployment.pairs) {
    addToken(pair.base);
    addToken(pair.quote);
  }
  return rows;

  function addToken(token) {
    const wrapper = token.address;
    const key = wrapper.toLowerCase();
    if (seen.has(key)) return;
    const symbol = token.symbol.replace(/^e/, "");
    const underlyingKey = `m${symbol}`;
    if (!deployment.underlying[underlyingKey]) {
      throw new Error(`missing ${underlyingKey} in deployment underlying addresses`);
    }
    seen.add(key);
    rows.push({ key: underlyingKey, wrapper, decimals: token.decimals });
  }
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.resolve(root, relPath), "utf8"));
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).reduce((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return acc;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return acc;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    acc[key] = value;
    return acc;
  }, {});
}

function readPositiveIntEnv(value, fallback, label) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${label} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function toUnits(value, decimals) {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`invalid numeric value ${value}`);
  const [whole, fraction = ""] = value.split(".");
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

function computeCashAmount(assetAmount, priceCashPerAsset, assetDecimals) {
  return (assetAmount * priceCashPerAsset) / (10n ** BigInt(assetDecimals));
}

function maxBigint(...values) {
  return values.reduce((max, value) => value > max ? value : max, 0n);
}

function formatTxError(error) {
  return error?.shortMessage ?? error?.details ?? error?.message ?? String(error);
}

function installMemoryLocalStorage() {
  const data = new Map();
  const storage = {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    key(index) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key) {
      data.delete(key);
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
