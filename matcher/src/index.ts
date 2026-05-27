import { loadConfig } from "./config.js";
import { create as createDb } from "./db/client.js";
import type { Db } from "./db/client.js";
import { makeChain } from "./chain/client.js";
import { dexFor, dexEvents } from "./chain/dex.js";
import { indexDexEvent, subscribe } from "./chain/events.js";
import { catchup, startCatchupPoller } from "./workers/catchup.js";
import { closeBatchIfReady, startBatchCloser } from "./workers/batch-closer.js";
import { settleOneMatch, startSettler } from "./workers/settler.js";
import { matchClosedBatches, onBatchClosed, startBatchMatcher } from "./workers/batch-matcher.js";
import { startRetryWorker } from "./workers/retry-worker.js";
import { initCofhe } from "./fhe/permit.js";
import { startHttp } from "./http/server.js";
import { createAgentOrderService } from "./agent/orders.js";
import { createAgentX402Middleware } from "./http/x402-agent.js";
import { getDeployment } from "../../shared/addresses/index.js";
import { runTask, type TaskRow } from "./tasks/store.js";
import { matches as matchesTable } from "./db/schema.js";
import { and, eq } from "drizzle-orm";
import { verifyAuditTranscriptFromS3 } from "./audit/verifier.js";
import { reconcileOrderStatusesFromMatches } from "./orders/lifecycle.js";

async function main() {
  const cfg = await loadConfig();
  if (!cfg.MATCHER_PRIVATE_KEY) {
    throw new Error("MATCHER_PRIVATE_KEY is required for autonomous matcher operation");
  }

  const db = createDb(cfg.RDS_URL);
  const chain = makeChain(cfg.ARB_SEPOLIA_RPC_URL, cfg.ARB_SEPOLIA_WS_URL, cfg.MATCHER_PRIVATE_KEY);
  const dep = getDeployment(cfg.chainId);
  const dex = dexFor(dep.dex, chain.wallet);
  const deploymentScope = {
    chainId: cfg.chainId,
    dexAddress: dep.dex.toLowerCase(),
  };

  const onChainMatcher = (await (dex as any).matcher()) as string;
  if (onChainMatcher.toLowerCase() !== chain.wallet.address.toLowerCase()) {
    throw new Error(`role mismatch: chain matcher ${onChainMatcher}, wallet ${chain.wallet.address}`);
  }

  await initCofhe({
    privateKey: cfg.MATCHER_PRIVATE_KEY as `0x${string}`,
    rpcUrl: cfg.ARB_SEPOLIA_RPC_URL,
    chainId: cfg.chainId,
  });

  // Default fromBlock = a few blocks before deploy (commit f9215c2). Avoids a 269M-block scan.
  const DEPLOY_BLOCK = 269_080_000;
  const indexEvent = (ev: any) => indexDexEvent(dex, db, ev, {
    chainId: cfg.chainId,
    dexAddress: deploymentScope.dexAddress,
  });
  const auditCtx = {
    bucket: cfg.S3_BUCKET,
    matcherAddress: chain.wallet.address,
    signMessage: (msg: string) => chain.wallet.signMessage(msg),
  };
  const batchMatcherOptions = {
    chainId: cfg.chainId,
    matchDelaySec: cfg.MATCHER_BATCH_MATCH_DELAY_SEC,
  };
  const matchBatch = (batchId: bigint) => onBatchClosed(dex, dep.dex, db, batchId, dep.pairs as any, auditCtx, batchMatcherOptions);
  const indexAndMatchClosedBatch = async (ev: any) => {
    await indexEvent(ev);
    const batchId = BigInt(ev.args.batchId.toString());
    await runTask(db, {
      type: "MATCH_BATCH",
      scope: "SYSTEM",
      batchId,
      payload: { source: "batch_closed_event" },
    }, async () => matchBatch(batchId));
  };

  await catchup(dex, db, DEPLOY_BLOCK, indexEvent, {
    chainId: cfg.chainId,
    dexAddress: deploymentScope.dexAddress,
    chunkSize: cfg.MATCHER_CATCHUP_CHUNK_SIZE,
    confirmationDepth: cfg.MATCHER_INDEX_CONFIRMATIONS,
  });
  await reconcileOrderStatusesFromMatches(db, deploymentScope);
  await matchClosedBatches(dex, dep.dex, db, dep.pairs as any, auditCtx, 5, batchMatcherOptions);
  startCatchupPoller(
    dex,
    db,
    DEPLOY_BLOCK,
    indexEvent,
    {
      chainId: cfg.chainId,
      dexAddress: deploymentScope.dexAddress,
      chunkSize: cfg.MATCHER_CATCHUP_CHUNK_SIZE,
      confirmationDepth: cfg.MATCHER_INDEX_CONFIRMATIONS,
      intervalSec: cfg.MATCHER_CATCHUP_INTERVAL_SEC,
    }
  );

  subscribe(dexEvents(dep.dex, chain.wsProvider), {
    OrderSubmitted: indexEvent,
    OrderSubmittedPrivate: indexEvent,
    BatchClosed: indexAndMatchClosedBatch,
    MatchPublished: indexEvent,
    MatchDisputed: indexEvent,
    MatchSettled: indexEvent,
  });

  const disputeWindow = Number(await (dex as any).disputeWindow());
  startBatchCloser(dex, indexAndMatchClosedBatch, {
    emptyBatchCloseAfterSec: cfg.MATCHER_EMPTY_BATCH_CLOSE_AFTER_SEC,
    db,
    chainId: cfg.chainId,
    dexAddress: deploymentScope.dexAddress,
  });
  startBatchMatcher(dex, dep.dex, db, dep.pairs as any, auditCtx, batchMatcherOptions);
  startSettler(dex, db, disputeWindow, deploymentScope);
  startRetryWorker(db, {
    CLOSE_BATCH: async (task) => {
      if (!task.batchId) throw new Error("CLOSE_BATCH task missing batchId");
      return closeBatchIfReady(dex, task.batchId, indexAndMatchClosedBatch);
    },
    MATCH_BATCH: async (task) => {
      if (!task.batchId) throw new Error("MATCH_BATCH task missing batchId");
      return matchBatch(task.batchId);
    },
    SETTLE_MATCH: async (task) => {
      if (!task.matchId) throw new Error("SETTLE_MATCH task missing matchId");
      return settleOneMatch(dex, db, task.matchId, deploymentScope);
    },
    VERIFY_AUDIT: async (task) => verifyAuditTask(task, db, cfg.S3_BUCKET, chain.wallet.address, deploymentScope),
  }, {
    intervalSec: cfg.MATCHER_RETRY_WORKER_INTERVAL_SEC,
    leaseSec: cfg.MATCHER_TASK_LEASE_SEC,
  });
  const agentOrders = createAgentOrderService({ cfg, deployment: dep });
  startHttp(cfg.HTTP_PORT, db, chain.wallet.address, async (batchId) => {
    await matchBatch(batchId);
  }, {
    orderService: agentOrders,
    paymentMiddleware: createAgentX402Middleware(cfg),
    x402Enabled: cfg.X402_AGENT_ENABLED,
    devBypassToken: cfg.AGENT_ORDER_DEV_BYPASS_TOKEN,
  }, {
    dex,
    dexAddress: dep.dex,
    chainId: cfg.chainId,
    pairs: dep.pairs,
    disputeWindowSec: disputeWindow,
    matchDelaySec: cfg.MATCHER_BATCH_MATCH_DELAY_SEC,
    confirmationDepth: cfg.MATCHER_INDEX_CONFIRMATIONS,
    auditBucket: cfg.S3_BUCKET,
    corsOrigins: parseCorsOrigins(cfg.MATCHER_CORS_ORIGINS),
  });
}

main().catch((e) => { console.error(e); process.exit(1); });

function parseCorsOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((origin) => origin.trim()).filter(Boolean);
}

async function verifyAuditTask(task: TaskRow, db: Db, bucket: string, matcherAddress: string, scope: { chainId: number; dexAddress: string }) {
  if (!task.matchId) throw new Error("VERIFY_AUDIT task missing matchId");
  const match = await db.select().from(matchesTable).where(and(
    eq(matchesTable.chainId, scope.chainId),
    eq(matchesTable.dexAddress, scope.dexAddress),
    eq(matchesTable.id, task.matchId),
  )).limit(1).then((rows) => rows[0]);
  if (!match) throw new Error(`match ${task.matchId.toString()} not found`);
  if (!match.auditS3Key) throw new Error(`match ${task.matchId.toString()} has no audit transcript`);
  return {
    verification: await verifyAuditTranscriptFromS3({
      bucket,
      key: match.auditS3Key,
      match,
      matcherAddress,
    }),
  };
}
