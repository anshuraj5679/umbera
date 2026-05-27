import type { Contract } from "ethers";
import type { Db } from "../db/client.js";
import { matchBatch } from "../matching/runner.js";
import { encryptUint128 } from "../matching/encode.js";
import { batches as batchesTable, errors as errorsTable, matches as matchesTable, orders as ordersTable } from "../db/schema.js";
import { writeAuditLog } from "../audit/s3.js";
import { and, asc, eq, sql } from "drizzle-orm";
import cron from "node-cron";
import { runTask } from "../tasks/store.js";
import { markOrdersMatched, normalizeDexAddress, type DeploymentScope } from "../orders/lifecycle.js";

const inFlightBatches = new Set<string>();
const DEFAULT_MATCH_DELAY_SEC = 15;

export type BatchMatcherOptions = {
  chainId?: number;
  matchDelaySec?: number;
  bypassDelay?: boolean;
  now?: () => Date;
};

export type BatchReadiness =
  | { status: "READY"; indexedOrderCount: bigint; onChainOrderCount: bigint }
  | { status: "WAITING_DELAY"; indexedOrderCount: bigint; onChainOrderCount: bigint; readyAt: Date }
  | { status: "INDEX_INCOMPLETE"; indexedOrderCount: bigint; onChainOrderCount: bigint };

export type BatchMatchOutcome = {
  status: "ALREADY_IN_FLIGHT" | "WAITING_DELAY" | "INDEX_INCOMPLETE" | "MATCHED" | "MATCHED_EMPTY" | "PAIR_FAILURE";
  batchId: string;
  indexedOrderCount?: string;
  onChainOrderCount?: string;
  readyAt?: string;
  published?: number;
  existingPairs?: number;
  failedPairs?: number;
};

function privateMatchFlow(m: { buyOrderId: bigint; sellOrderId: bigint; cashAmount: bigint; assetAmount: bigint }) {
  if (m.buyOrderId < m.sellOrderId) {
    return {
      orderAId: m.buyOrderId,
      orderBId: m.sellOrderId,
      baseToA: 0n,
      quoteToA: m.assetAmount,
      baseToB: m.cashAmount,
      quoteToB: 0n,
    };
  }
  return {
    orderAId: m.sellOrderId,
    orderBId: m.buyOrderId,
    baseToA: m.cashAmount,
    quoteToA: 0n,
    baseToB: 0n,
    quoteToB: m.assetAmount,
  };
}

export async function onBatchClosed(
  dex: Contract,
  dexAddr: string,
  db: Db,
  batchId: bigint,
  pairs: Array<{ id: number; base: { decimals: number }; quote: { decimals: number } }>,
  auditCtx: { bucket: string; matcherAddress: string; signMessage: (msg: string) => Promise<string> },
  options: BatchMatcherOptions = {}
): Promise<BatchMatchOutcome> {
  const scope = matcherScope(dexAddr, options);
  const batchKey = batchId.toString();
  const inFlightKey = `${scope.chainId}:${scope.dexAddress}:${batchKey}`;
  if (inFlightBatches.has(inFlightKey)) {
    console.log("batch match already in flight, skipping", inFlightKey);
    return { status: "ALREADY_IN_FLIGHT", batchId: batchKey };
  }
  inFlightBatches.add(inFlightKey);

  try {
    const readiness = await getBatchReadiness(dex, db, batchId, options, scope);
    if (readiness.status === "WAITING_DELAY") {
      console.log("batch match delayed", batchKey, "readyAt", readiness.readyAt.toISOString());
      return {
        status: "WAITING_DELAY",
        batchId: batchKey,
        indexedOrderCount: readiness.indexedOrderCount.toString(),
        onChainOrderCount: readiness.onChainOrderCount.toString(),
        readyAt: readiness.readyAt.toISOString(),
      };
    }
    if (readiness.status === "INDEX_INCOMPLETE") {
      console.log(
        "batch index incomplete, leaving CLOSED",
        batchKey,
        "indexed",
        readiness.indexedOrderCount.toString(),
        "chain",
        readiness.onChainOrderCount.toString(),
      );
      return {
        status: "INDEX_INCOMPLETE",
        batchId: batchKey,
        indexedOrderCount: readiness.indexedOrderCount.toString(),
        onChainOrderCount: readiness.onChainOrderCount.toString(),
      };
    }

    let published = 0;
    let existingPairs = 0;
    let failedPairs = 0;
    for (const p of pairs) {
      try {
        const existing = await db.select({ id: matchesTable.id })
          .from(matchesTable)
          .where(and(
            eq(matchesTable.chainId, scope.chainId),
            eq(matchesTable.dexAddress, scope.dexAddress),
            eq(matchesTable.batchId, batchId),
            eq(matchesTable.pairId, p.id),
          ))
          .limit(1);
        if (existing.length > 0) {
          existingPairs++;
          console.log("batch pair already matched, skipping", batchKey, p.id);
          continue;
        }

        const res = await matchBatch(dex, dexAddr, db, batchId, p.id, { base: p.base.decimals, quote: p.quote.decimals }, {
          chainId: scope.chainId,
        });
        if (res.matches.length === 0) continue;
        const orderAs: bigint[] = [], orderBs: bigint[] = [];
        const baseToAs: any[] = [], quoteToAs: any[] = [], baseToBs: any[] = [], quoteToBs: any[] = [];
        for (const m of res.matches) {
          const flow = privateMatchFlow(m);
          orderAs.push(flow.orderAId);
          orderBs.push(flow.orderBId);
          baseToAs.push(await encryptUint128(flow.baseToA));
          quoteToAs.push(await encryptUint128(flow.quoteToA));
          baseToBs.push(await encryptUint128(flow.baseToB));
          quoteToBs.push(await encryptUint128(flow.quoteToB));
        }
        const tx = await (dex as any).publishMatches(orderAs, orderBs, baseToAs, quoteToAs, baseToBs, quoteToBs);
        const rcpt = await tx.wait();
        const events = rcpt.logs.filter((l: any) => l.fragment?.name === "MatchPublished");
        published += events.length;
        for (let i = 0; i < events.length; i++) {
          const matchId = (events[i] as any).args.matchId as bigint;
          const m = res.matches[i]!;
          const flow = privateMatchFlow(m);
          const publishedAt = new Date();
          let auditKey: string | null = `pair-${p.id}/batch-${batchId}/match-${matchId}.json`;
          try {
            await writeAuditLog(auditCtx.bucket, auditKey, {
              schema: "match-v2-private-auction-inputs",
              matchId: matchId.toString(),
              batchId: batchId.toString(),
              pairId: p.id,
              matchIndex: i,
              orderAId: flow.orderAId.toString(),
              orderBId: flow.orderBId.toString(),
              clearingPriceQuotePerBase: res.clearingPriceQuotePerBase.toString(),
              clearingPriceQuotePerBaseScaled: res.clearingPriceQuotePerBaseScaled.toString(),
              baseFilled: m.cashAmount.toString(),
              quoteFilled: m.assetAmount.toString(),
              auction: {
                cashDecimals: p.base.decimals,
                assetDecimals: p.quote.decimals,
                inputOrders: res.inputOrders.map(serializeDecryptedOrder),
                matches: res.matches.map(serializeAuctionMatch),
              },
              publishedAt: publishedAt.toISOString(),
              txHash: rcpt.hash,
              matcherAddress: auditCtx.matcherAddress,
            }, auditCtx.signMessage);
          } catch (e) {
            console.error("audit log write failed", matchId.toString(), e);
            await recordWorkerError(db, "batch-matcher", {
              batchId: batchKey,
              matchId: matchId.toString(),
              txHash: rcpt.hash,
              error: errorMessage(e),
            });
            auditKey = null;
          }
          await db.insert(matchesTable).values({
            chainId: scope.chainId,
            dexAddress: scope.dexAddress,
            id: matchId, batchId, pairId: p.id, buyOrderId: m.buyOrderId, sellOrderId: m.sellOrderId,
            clearingPriceNum: res.clearingPriceQuotePerBaseScaled.toString(),
            clearingPriceDen: "1000000000",
            baseFilled: m.cashAmount.toString(), quoteFilled: m.assetAmount.toString(),
            status: "PENDING", publishedAt, publishTxHash: rcpt.hash, auditS3Key: auditKey,
          }).onConflictDoUpdate({
            target: [matchesTable.chainId, matchesTable.dexAddress, matchesTable.id],
            set: {
              batchId,
              pairId: p.id,
              buyOrderId: m.buyOrderId,
              sellOrderId: m.sellOrderId,
              clearingPriceNum: res.clearingPriceQuotePerBaseScaled.toString(),
              clearingPriceDen: "1000000000",
              baseFilled: m.cashAmount.toString(),
              quoteFilled: m.assetAmount.toString(),
              status: "PENDING",
              publishedAt,
              publishTxHash: rcpt.hash,
              auditS3Key: auditKey,
            },
          });
          await markOrdersMatched(db, [m.buyOrderId, m.sellOrderId], scope);
        }
      } catch (e) {
        failedPairs++;
        console.error("batch pair match failed", batchKey, p.id, e);
        await recordWorkerError(db, "batch-matcher", {
          batchId: batchKey,
          pairId: p.id,
          error: errorMessage(e),
        });
      }
    }

    if (failedPairs === 0) {
      const nextStatus = published > 0 || existingPairs > 0 ? "MATCHED" : "MATCHED_EMPTY";
      await db.update(batchesTable)
        .set({ status: nextStatus })
        .where(scopedIdWhere(batchesTable, scope, batchId));
      console.log("batch matched", batchKey, "published", published, "existingPairs", existingPairs, "failedPairs", failedPairs);
      return {
        status: nextStatus,
        batchId: batchKey,
        indexedOrderCount: readiness.indexedOrderCount.toString(),
        onChainOrderCount: readiness.onChainOrderCount.toString(),
        published,
        existingPairs,
        failedPairs,
      };
    }
    console.log("batch match incomplete", batchKey, "published", published, "existingPairs", existingPairs, "failedPairs", failedPairs);
    return {
      status: "PAIR_FAILURE",
      batchId: batchKey,
      indexedOrderCount: readiness.indexedOrderCount.toString(),
      onChainOrderCount: readiness.onChainOrderCount.toString(),
      published,
      existingPairs,
      failedPairs,
    };
  } finally {
    inFlightBatches.delete(inFlightKey);
  }
}

export async function matchClosedBatches(
  dex: Contract,
  dexAddr: string,
  db: Db,
  pairs: Array<{ id: number; base: { decimals: number }; quote: { decimals: number } }>,
  auditCtx: { bucket: string; matcherAddress: string; signMessage: (msg: string) => Promise<string> },
  limit = 5,
  options: BatchMatcherOptions = {}
) {
  const scope = matcherScope(dexAddr, options);
  const rows = await db.select()
    .from(batchesTable)
    .where(and(
      eq(batchesTable.chainId, scope.chainId),
      eq(batchesTable.dexAddress, scope.dexAddress),
      eq(batchesTable.status, "CLOSED"),
    ))
    .orderBy(asc(batchesTable.closedAt), asc(batchesTable.id))
    .limit(limit);
  for (const row of rows) {
    await runTask(db, {
      type: "MATCH_BATCH",
      scope: "SYSTEM",
      batchId: row.id,
      payload: { source: "closed_batch_scan" },
    }, async () => onBatchClosed(dex, dexAddr, db, row.id, pairs, auditCtx, options));
  }
}

export function startBatchMatcher(
  dex: Contract,
  dexAddr: string,
  db: Db,
  pairs: Array<{ id: number; base: { decimals: number }; quote: { decimals: number } }>,
  auditCtx: { bucket: string; matcherAddress: string; signMessage: (msg: string) => Promise<string> },
  options: BatchMatcherOptions = {}
) {
  let running = false;
  cron.schedule("*/1 * * * *", async () => {
    if (running) return;
    running = true;
    try {
      await matchClosedBatches(dex, dexAddr, db, pairs, auditCtx, 5, options);
    } catch (e) {
      console.error("closed batch match scan failed", e);
    } finally {
      running = false;
    }
  });
}

export async function getBatchReadiness(
  dex: Contract,
  db: Db,
  batchId: bigint,
  options: BatchMatcherOptions = {},
  scope: DeploymentScope = matcherScope(String((dex as any).target ?? (dex as any).address ?? "unknown"), options),
): Promise<BatchReadiness> {
  const [indexedOrderCount, onChainOrderCount, closedAt] = await Promise.all([
    getIndexedOrderCount(db, batchId, scope),
    getOnChainOrderCount(dex, batchId),
    getBatchClosedAt(dex, db, batchId, scope),
  ]);

  return evaluateBatchReadiness({
    indexedOrderCount,
    onChainOrderCount,
    closedAt,
    now: options.now?.() ?? new Date(),
    matchDelaySec: options.matchDelaySec ?? DEFAULT_MATCH_DELAY_SEC,
    bypassDelay: options.bypassDelay ?? false,
  });
}

export function evaluateBatchReadiness(input: {
  indexedOrderCount: bigint;
  onChainOrderCount: bigint;
  closedAt: Date | null;
  now: Date;
  matchDelaySec: number;
  bypassDelay?: boolean;
}): BatchReadiness {
  if (!input.bypassDelay && input.closedAt && input.matchDelaySec > 0) {
    const readyAt = new Date(input.closedAt.getTime() + input.matchDelaySec * 1000);
    if (input.now < readyAt) {
      return {
        status: "WAITING_DELAY",
        indexedOrderCount: input.indexedOrderCount,
        onChainOrderCount: input.onChainOrderCount,
        readyAt,
      };
    }
  }

  if (input.indexedOrderCount < input.onChainOrderCount) {
    return {
      status: "INDEX_INCOMPLETE",
      indexedOrderCount: input.indexedOrderCount,
      onChainOrderCount: input.onChainOrderCount,
    };
  }

  return {
    status: "READY",
    indexedOrderCount: input.indexedOrderCount,
    onChainOrderCount: input.onChainOrderCount,
  };
}

async function getIndexedOrderCount(db: Db, batchId: bigint, scope: DeploymentScope): Promise<bigint> {
  const row = await db.select({ value: sql<number>`count(*)::int` })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.chainId, scope.chainId),
      eq(ordersTable.dexAddress, scope.dexAddress),
      eq(ordersTable.batchId, batchId),
    ))
    .then((rows) => rows[0]);
  return BigInt(row?.value ?? 0);
}

async function getOnChainOrderCount(dex: Contract, batchId: bigint): Promise<bigint> {
  const value = await (dex as any).batchOrderCount(batchId);
  return BigInt(value.toString());
}

async function getBatchClosedAt(dex: Contract, db: Db, batchId: bigint, scope: DeploymentScope): Promise<Date | null> {
  const row = await db.select({ closedAt: batchesTable.closedAt })
    .from(batchesTable)
    .where(scopedIdWhere(batchesTable, scope, batchId))
    .limit(1)
    .then((rows) => rows[0]);
  if (row?.closedAt) return row.closedAt;

  const batch = await (dex as any).batches(batchId);
  const closedAt = BigInt((batch.closedAt ?? batch[1] ?? 0).toString());
  return closedAt > 0n ? new Date(Number(closedAt) * 1000) : null;
}

async function recordWorkerError(db: Db, component: string, payload: Record<string, unknown>) {
  try {
    await db.insert(errorsTable).values({ component, payload });
  } catch (e) {
    console.error("failed to record worker error", e);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function matcherScope(dexAddr: string, options: BatchMatcherOptions): DeploymentScope {
  return {
    chainId: options.chainId ?? 421614,
    dexAddress: normalizeDexAddress(dexAddr),
  };
}

function scopedIdWhere(table: { chainId: any; dexAddress: any; id: any }, scope: DeploymentScope, id: bigint) {
  return and(
    eq(table.chainId, scope.chainId),
    eq(table.dexAddress, scope.dexAddress),
    eq(table.id, id),
  );
}

function serializeDecryptedOrder(order: {
  id: bigint;
  side: "BUY" | "SELL";
  remainingDeposit: bigint;
  remainingRequest: bigint;
  cashDecimals: number;
  assetDecimals: number;
}) {
  return {
    id: order.id.toString(),
    side: order.side,
    remainingDeposit: order.remainingDeposit.toString(),
    remainingRequest: order.remainingRequest.toString(),
    cashDecimals: order.cashDecimals,
    assetDecimals: order.assetDecimals,
  };
}

function serializeAuctionMatch(match: {
  buyOrderId: bigint;
  sellOrderId: bigint;
  cashAmount: bigint;
  assetAmount: bigint;
}) {
  return {
    buyOrderId: match.buyOrderId.toString(),
    sellOrderId: match.sellOrderId.toString(),
    cashAmount: match.cashAmount.toString(),
    assetAmount: match.assetAmount.toString(),
  };
}
