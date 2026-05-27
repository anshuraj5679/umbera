import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "../src/config.js";
import { makeChain } from "../src/chain/client.js";
import { dexFor } from "../src/chain/dex.js";
import { create as createDb } from "../src/db/client.js";
import { initCofhe } from "../src/fhe/permit.js";
import { matchBatch } from "../src/matching/runner.js";
import { onBatchClosed } from "../src/workers/batch-matcher.js";
import { getDeployment } from "../../shared/addresses/index.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
loadDotenv({ path: path.join(repoRoot, ".env") });

async function main() {
  const args = process.argv.slice(2);
  const batchIdArg = args.find((arg) => /^\d+$/.test(arg));
  if (!batchIdArg) throw new Error("Usage: tsx scripts/rematch-batch.ts <batchId> [--dry-run]");
  const dryRun = args.includes("--dry-run");
  const batchId = BigInt(batchIdArg);

  const cfg = await loadConfig();
  if (!cfg.MATCHER_PRIVATE_KEY) {
    throw new Error("MATCHER_PRIVATE_KEY is required for rematch.");
  }

  const deployment = getDeployment(cfg.chainId);
  const db = createDb(cfg.RDS_URL);
  const chain = makeChain(cfg.ARB_SEPOLIA_RPC_URL, cfg.ARB_SEPOLIA_WS_URL, cfg.MATCHER_PRIVATE_KEY);
  const dex = dexFor(deployment.dex, chain.wallet);
  const onChainMatcher = (await (dex as any).matcher()) as string;
  if (onChainMatcher.toLowerCase() !== chain.wallet.address.toLowerCase()) {
    throw new Error(`role mismatch: chain matcher ${onChainMatcher}, wallet ${chain.wallet.address}`);
  }

  await initCofhe({
    privateKey: cfg.MATCHER_PRIVATE_KEY as `0x${string}`,
    rpcUrl: cfg.ARB_SEPOLIA_RPC_URL,
    chainId: cfg.chainId,
  });

  if (dryRun) {
    const pairResults = [];
    for (const pair of deployment.pairs) {
      const result = await matchBatch(dex, deployment.dex, db, batchId, pair.id, {
        base: pair.base.decimals,
        quote: pair.quote.decimals,
      });
      pairResults.push({
        pairId: pair.id,
        matches: result.matches.map((match) => ({
          buyOrderId: match.buyOrderId.toString(),
          sellOrderId: match.sellOrderId.toString(),
          assetAmount: match.assetAmount.toString(),
          cashAmount: match.cashAmount.toString(),
        })),
        clearingPriceQuotePerBase: result.clearingPriceQuotePerBase.toString(),
        clearingPriceQuotePerBaseScaled: result.clearingPriceQuotePerBaseScaled.toString(),
      });
    }
    console.log(JSON.stringify({ ok: true, dryRun: true, batchId: batchId.toString(), pairResults }, null, 2));
    return;
  }

  await onBatchClosed(dex, deployment.dex, db, batchId, deployment.pairs, {
    bucket: cfg.S3_BUCKET,
    matcherAddress: chain.wallet.address,
    signMessage: (message) => chain.wallet.signMessage(message),
  }, {
    bypassDelay: true,
    matchDelaySec: cfg.MATCHER_BATCH_MATCH_DELAY_SEC,
  });
  console.log(JSON.stringify({ ok: true, dryRun: false, batchId: batchId.toString() }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
