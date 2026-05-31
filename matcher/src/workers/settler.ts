import cron from "node-cron";
import type { Contract } from "ethers";
import type { Db } from "../db/client.js";
import { matches as matchesTable } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { runTask } from "../tasks/store.js";
import { markOrdersSettled, type DeploymentScope } from "../orders/lifecycle.js";
import { verifyAuditTranscriptFromS3 } from "../audit/verifier.js";

export type SettlementMatchRow = {
  id: bigint;
  auditS3Key: string | null;
};

export type SettlementReceiptLike = {
  hash?: string;
  status?: number | null;
};

export type SettlementProofContext = {
  auditBucket: string;
  matcherAddress: string;
};

export function startSettler(dex: Contract, db: Db, disputeWindowSec: number, scope: DeploymentScope, proofCtx: SettlementProofContext) {
  let running = false;
  cron.schedule("*/30 * * * * *", async () => {
    if (running) return;
    running = true;
    try {
      const rows = await db.select().from(matchesTable).where(matchStatusWhere("PENDING", scope)).limit(20);
      const block = await dex.runner!.provider!.getBlock("latest");
      const now = BigInt(block?.timestamp ?? Math.floor(Date.now() / 1000));
      for (const r of rows) {
        try {
          const info = await (dex as any).getMatchInfo(r.id);
          const publishedAt = BigInt((info.publishedAt ?? info[3]).toString());
          const status = Number(info.status ?? info[4]);
          if (status !== 0) {
            await db.update(matchesTable).set({ status: matchStatusLabel(status) }).where(scopedIdWhere(r.id, scope));
            continue;
          }
          if (now < publishedAt + BigInt(disputeWindowSec)) continue;
          await runTask(db, {
            type: "SETTLE_MATCH",
            scope: "SYSTEM",
            batchId: r.batchId,
            matchId: r.id,
            idempotencyKey: `settle:${scopeKey(scope)}:${r.id.toString()}`,
            payload: { pairId: r.pairId },
          }, async () => settleOneMatch(dex, db, r.id, scope, proofCtx));
        } catch (e) { console.error("settle failed", r.id.toString(), e); }
      }
    } finally {
      running = false;
    }
  });
}

export async function settleOneMatch(
  dex: Contract,
  db: Db,
  matchId: bigint,
  scope: DeploymentScope,
  proofCtx: SettlementProofContext,
) {
  const match = await db.select()
    .from(matchesTable)
    .where(scopedIdWhere(matchId, scope))
    .limit(1)
    .then((rows) => rows[0]);
  assertSettlementMatchReady(match);
  await assertSettlementProofReady(match, proofCtx);

  await (dex as any).settleMatch.staticCall(matchId);
  const tx = await (dex as any).settleMatch(matchId);
  const rcpt = await tx.wait();
  assertSettlementReceiptSucceeded(rcpt);
  await db.update(matchesTable)
    .set({ status: "SETTLED", settledAt: new Date(), settleTxHash: rcpt.hash })
    .where(scopedIdWhere(matchId, scope));
  await markOrdersSettled(db, [match.buyOrderId, match.sellOrderId], scope);
  console.log("settled", matchId.toString());
  return {
    ok: true,
    matchId: matchId.toString(),
    txHash: rcpt.hash,
    blockNumber: rcpt.blockNumber?.toString?.() ?? null,
  };
}

export function assertSettlementMatchReady<T extends SettlementMatchRow>(match: T | null | undefined): asserts match is T {
  if (!match) {
    throw new Error("settlement blocked: match is not indexed");
  }
  if (!match.auditS3Key) {
    throw new Error(`settlement blocked: match ${match.id.toString()} has no audit transcript`);
  }
}

export function assertSettlementReceiptSucceeded(receipt: SettlementReceiptLike | null | undefined) {
  if (!receipt) {
    throw new Error("settlement failed: missing transaction receipt");
  }
  if (receipt.status !== 1) {
    throw new Error(`settlement failed: receipt status ${receipt.status ?? "unknown"}`);
  }
}

async function assertSettlementProofReady(match: NonNullable<Awaited<ReturnType<typeof selectMatchForSettlement>>>, proofCtx: SettlementProofContext) {
  if (!match.auditS3Key) {
    throw new Error(`settlement blocked: match ${match.id.toString()} has no audit transcript`);
  }
  const verification = await verifyAuditTranscriptFromS3({
    bucket: proofCtx.auditBucket,
    key: match.auditS3Key,
    match,
    matcherAddress: proofCtx.matcherAddress,
  });
  if (!verification.ok) {
    throw new Error(`settlement blocked: match ${match.id.toString()} audit receipt is invalid`);
  }
  if (!verification.proofReceipt.commitments.salted) {
    throw new Error(`settlement blocked: match ${match.id.toString()} audit receipt is not salted`);
  }
}

async function selectMatchForSettlement(db: Db, matchId: bigint, scope: DeploymentScope) {
  return db.select()
    .from(matchesTable)
    .where(scopedIdWhere(matchId, scope))
    .limit(1)
    .then((rows) => rows[0]);
}

function matchStatusLabel(value: number): string {
  return ["PENDING", "DISPUTED", "SETTLED", "VOIDED"][value] ?? "UNKNOWN";
}

function scopedIdWhere(matchId: bigint, scope?: DeploymentScope) {
  const conditions = [eq(matchesTable.id, matchId)];
  if (scope) {
    conditions.unshift(eq(matchesTable.dexAddress, scope.dexAddress));
    conditions.unshift(eq(matchesTable.chainId, scope.chainId));
  }
  return and(...conditions);
}

function matchStatusWhere(status: string, scope?: DeploymentScope) {
  const conditions = [eq(matchesTable.status, status)];
  if (scope) {
    conditions.unshift(eq(matchesTable.dexAddress, scope.dexAddress));
    conditions.unshift(eq(matchesTable.chainId, scope.chainId));
  }
  return and(...conditions);
}

function scopeKey(scope?: DeploymentScope) {
  return scope ? `${scope.chainId}:${scope.dexAddress}` : "legacy";
}
