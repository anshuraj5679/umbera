import type { Contract } from "ethers";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { batches as batchesTable, errors as errorsTable, matches as matchesTable, orders as ordersTable } from "../db/schema.js";
import { createTask, taskByIdempotencyKey } from "../tasks/store.js";
import { normalizeDexAddress, type DeploymentScope } from "../orders/lifecycle.js";

export type InvariantSeverity = "BLOCKING" | "WARNING";
export type InvariantIssue = {
  severity: InvariantSeverity;
  code: string;
  message: string;
  batchId?: string;
  matchId?: string;
  indexedOrderCount?: string;
  onChainOrderCount?: string | null;
  taskType?: string;
};

export type InvariantReport = {
  ok: boolean;
  chainId: number;
  dexAddress: string;
  blockingCount: number;
  warningCount: number;
  issues: InvariantIssue[];
  checkedAt: string;
};

export async function buildInvariantReport(db: Db, input: {
  dex?: Contract;
  chainId: number;
  dexAddress: string;
  disputeWindowSec: number;
  limit?: number;
}): Promise<InvariantReport> {
  const scope = { chainId: input.chainId, dexAddress: normalizeDexAddress(input.dexAddress) };
  const limit = input.limit ?? 25;
  const issues: InvariantIssue[] = [];

  const closed = await db.select()
    .from(batchesTable)
    .where(and(scopeWhere(batchesTable, scope), eq(batchesTable.status, "CLOSED")))
    .orderBy(desc(batchesTable.closedAt), desc(batchesTable.id))
    .limit(limit);
  for (const batch of closed) {
    const [indexedOrderCount, onChainOrderCount] = await Promise.all([
      countOrdersForBatch(db, scope, batch.id),
      input.dex ? readBatchOrderCount(input.dex, batch.id).catch(() => null) : Promise.resolve(null),
    ]);
    issues.push({
      severity: onChainOrderCount !== null && indexedOrderCount < onChainOrderCount ? "WARNING" : "BLOCKING",
      code: onChainOrderCount !== null && indexedOrderCount < onChainOrderCount
        ? "BATCH_INDEX_INCOMPLETE"
        : "CLOSED_BATCH_WAITING_FOR_MATCH",
      message: onChainOrderCount !== null && indexedOrderCount < onChainOrderCount
        ? "Closed batch is waiting for index completeness before matching."
        : "Closed batch is ready for match retry.",
      batchId: batch.id.toString(),
      indexedOrderCount: indexedOrderCount.toString(),
      onChainOrderCount: onChainOrderCount?.toString() ?? null,
      taskType: "MATCH_BATCH",
    });
  }

  const missingAudits = await db.select()
    .from(matchesTable)
    .where(and(scopeWhere(matchesTable, scope), isNull(matchesTable.auditS3Key)))
    .orderBy(desc(matchesTable.publishedAt), desc(matchesTable.id))
    .limit(limit);
  for (const match of missingAudits) {
    issues.push({
      severity: "BLOCKING",
      code: "MATCH_MISSING_AUDIT_RECEIPT",
      message: "Published match is missing a signed audit receipt.",
      batchId: match.batchId.toString(),
      matchId: match.id.toString(),
      taskType: "REPAIR_AUDIT_KEYS",
    });
  }

  const cutoff = new Date(Date.now() - input.disputeWindowSec * 1000);
  const pendingPastWindow = await db.select()
    .from(matchesTable)
    .where(and(
      scopeWhere(matchesTable, scope),
      eq(matchesTable.status, "PENDING"),
      lte(matchesTable.publishedAt, cutoff),
    ))
    .orderBy(desc(matchesTable.publishedAt), desc(matchesTable.id))
    .limit(limit);
  for (const match of pendingPastWindow) {
    issues.push({
      severity: match.auditS3Key ? "BLOCKING" : "WARNING",
      code: match.auditS3Key ? "MATCH_READY_FOR_SETTLEMENT" : "MATCH_WAITING_FOR_AUDIT_RECEIPT",
      message: match.auditS3Key
        ? "Match is past dispute window and should be settled."
        : "Match is past dispute window but still needs an audit receipt before settlement.",
      batchId: match.batchId.toString(),
      matchId: match.id.toString(),
      taskType: match.auditS3Key ? "SETTLE_MATCH" : "REPAIR_AUDIT_KEYS",
    });
  }

  const unresolvedErrors = await db.select()
    .from(errorsTable)
    .where(isNull(errorsTable.resolvedAt))
    .orderBy(desc(errorsTable.occurredAt))
    .limit(10);
  for (const row of unresolvedErrors) {
    issues.push({
      severity: "WARNING",
      code: "UNRESOLVED_WORKER_ERROR",
      message: `Unresolved worker error in ${row.component}.`,
    });
  }

  const blockingCount = issues.filter((issue) => issue.severity === "BLOCKING").length;
  const warningCount = issues.filter((issue) => issue.severity === "WARNING").length;
  return {
    ok: blockingCount === 0,
    chainId: scope.chainId,
    dexAddress: scope.dexAddress,
    blockingCount,
    warningCount,
    issues,
    checkedAt: new Date().toISOString(),
  };
}

export async function enqueueInvariantRepairs(db: Db, report: InvariantReport) {
  const tasks = [];
  const repairAudit = report.issues.some((issue) => issue.taskType === "REPAIR_AUDIT_KEYS");
  if (repairAudit) {
    tasks.push(await createTaskIfMissing(db, {
      idempotencyKey: `reconcile:${report.chainId}:${report.dexAddress}:repair-audit`,
      type: "REPAIR_AUDIT_KEYS",
      scope: "OPERATOR",
      payload: { source: "invariant_reconcile", limit: 100 },
    }));
  }
  for (const issue of report.issues) {
    if (issue.taskType === "MATCH_BATCH" && issue.batchId) {
      tasks.push(await createTaskIfMissing(db, {
        idempotencyKey: `reconcile:${report.chainId}:${report.dexAddress}:match:${issue.batchId}`,
        type: "MATCH_BATCH",
        scope: "OPERATOR",
        batchId: BigInt(issue.batchId),
        payload: { source: "invariant_reconcile" },
      }));
    }
    if (issue.taskType === "SETTLE_MATCH" && issue.matchId) {
      tasks.push(await createTaskIfMissing(db, {
        idempotencyKey: `reconcile:${report.chainId}:${report.dexAddress}:settle:${issue.matchId}`,
        type: "SETTLE_MATCH",
        scope: "OPERATOR",
        matchId: BigInt(issue.matchId),
        payload: { source: "invariant_reconcile" },
      }));
    }
  }
  return { enqueued: tasks.filter(Boolean) };
}

async function createTaskIfMissing(db: Db, input: Parameters<typeof createTask>[1]) {
  const existing = input.idempotencyKey ? await taskByIdempotencyKey(db, input.idempotencyKey) : null;
  if (existing) return { task: existing.id, type: existing.type, status: existing.status, replayed: true };
  const task = await createTask(db, input);
  return { task: task.id, type: task.type, status: task.status, replayed: false };
}

async function countOrdersForBatch(db: Db, scope: DeploymentScope, batchId: bigint) {
  const row = await db.select({ value: sql<number>`count(*)::int` })
    .from(ordersTable)
    .where(and(scopeWhere(ordersTable, scope), eq(ordersTable.batchId, batchId)))
    .then((rows) => rows[0]);
  return BigInt(row?.value ?? 0);
}

async function readBatchOrderCount(dex: Contract, batchId: bigint) {
  const value = await (dex as any).batchOrderCount(batchId);
  return BigInt(value.toString());
}

function scopeWhere(table: { chainId: any; dexAddress: any }, scope: DeploymentScope) {
  return and(
    eq(table.chainId, scope.chainId),
    sql`lower(${table.dexAddress}) = ${scope.dexAddress}`,
  );
}
