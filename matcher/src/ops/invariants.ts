import type { Contract } from "ethers";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { batches as batchesTable, errors as errorsTable, matches as matchesTable, orders as ordersTable } from "../db/schema.js";
import { createTask, taskByIdempotencyKey } from "../tasks/store.js";
import { normalizeDexAddress, type DeploymentScope } from "../orders/lifecycle.js";
import { countPrivateTaskResidue, type PrivacyResidueCounts } from "../privacy/scrub.js";
import { scanAuditObjectPrivacy, type AuditObjectPrivacyScan } from "../audit/privacy.js";

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
  count?: number;
  columns?: string[];
  forbiddenFields?: string[];
  schema?: string | null;
};

export type InvariantReport = {
  ok: boolean;
  chainId: number;
  dexAddress: string;
  blockingCount: number;
  warningCount: number;
  issues: InvariantIssue[];
  privacy: PrivacyPostureReport;
  checkedAt: string;
};

export type PrivacyPostureReport = {
  ok: boolean;
  blockingCount: number;
  warningCount: number;
  legacyOrderColumns: string[];
  nonPrivateOrderSideRows: number;
  agentAccessTokenHashInvalidRows: number;
  expiredActiveAccessTokenRows: number;
  residue: PrivacyResidueCounts;
  auditObjects?: AuditObjectPrivacyScan;
};

export async function buildInvariantReport(db: Db, input: {
  dex?: Contract;
  chainId: number;
  dexAddress: string;
  disputeWindowSec: number;
  limit?: number;
  auditBucket?: string;
  auditPrivacyScanLimit?: number;
}): Promise<InvariantReport> {
  const scope = { chainId: input.chainId, dexAddress: normalizeDexAddress(input.dexAddress) };
  const limit = input.limit ?? 25;
  const issues: InvariantIssue[] = [];
  const privacy = await buildPrivacyPostureReport(db, scope, {
    auditBucket: input.auditBucket,
    auditPrivacyScanLimit: input.auditPrivacyScanLimit ?? Math.min(limit, 5),
  });
  addPrivacyIssues(issues, privacy);

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
    privacy,
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
  const scrubPrivateTaskData = report.issues.some((issue) => issue.taskType === "SCRUB_PRIVATE_TASK_DATA");
  if (scrubPrivateTaskData) {
    tasks.push(await createTaskIfMissing(db, {
      idempotencyKey: `reconcile:${report.chainId}:${report.dexAddress}:scrub-private-task-data`,
      type: "SCRUB_PRIVATE_TASK_DATA",
      scope: "OPERATOR",
      payload: { source: "invariant_reconcile" },
    }));
  }
  const repairAuditPrivacy = report.issues.some((issue) => issue.taskType === "REPAIR_AUDIT_PRIVACY");
  if (repairAuditPrivacy) {
    tasks.push(await createTaskIfMissing(db, {
      idempotencyKey: `reconcile:${report.chainId}:${report.dexAddress}:repair-audit-privacy`,
      type: "REPAIR_AUDIT_PRIVACY",
      scope: "OPERATOR",
      payload: { source: "invariant_reconcile", limit: 25 },
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

export async function buildPrivacyPostureReport(db: Db, scope: DeploymentScope, options: {
  auditBucket?: string;
  auditPrivacyScanLimit?: number;
} = {}): Promise<PrivacyPostureReport> {
  const [
    legacyOrderColumns,
    nonPrivateOrderSideRows,
    agentAccessTokenHashInvalidRows,
    expiredActiveAccessTokenRows,
    residue,
    auditObjects,
  ] = await Promise.all([
    findLegacyOrderColumns(db),
    countNonPrivateOrderSides(db, scope),
    countInvalidAgentAccessTokenHashes(db, scope),
    countExpiredActiveAccessTokens(db, scope),
    countPrivateTaskResidue(db),
    options.auditBucket
      ? scanAuditObjectPrivacy(db, {
        scope,
        bucket: options.auditBucket,
        limit: options.auditPrivacyScanLimit ?? 5,
      })
      : Promise.resolve(undefined),
  ]);

  const blockingCount = [
    legacyOrderColumns.length > 0,
    nonPrivateOrderSideRows > 0,
    agentAccessTokenHashInvalidRows > 0,
    (auditObjects?.forbiddenFieldCount ?? 0) > 0,
  ].filter(Boolean).length;
  const warningCount = [
    residue.agentSubmitOrderTaskRows > 0,
    residue.taskEventRows > 0,
    residue.workerErrorRows > 0,
    (auditObjects?.legacySchemaCount ?? 0) > 0,
    (auditObjects?.failedCount ?? 0) > 0,
  ].filter(Boolean).length;

  return {
    ok: blockingCount === 0,
    blockingCount,
    warningCount,
    legacyOrderColumns,
    nonPrivateOrderSideRows,
    agentAccessTokenHashInvalidRows,
    expiredActiveAccessTokenRows,
    residue,
    auditObjects,
  };
}

function addPrivacyIssues(issues: InvariantIssue[], privacy: PrivacyPostureReport) {
  if (privacy.legacyOrderColumns.length > 0) {
    issues.push({
      severity: "BLOCKING",
      code: "LEGACY_PLAINTEXT_ORDER_COLUMNS",
      message: "Order table still contains legacy plaintext storage columns.",
      columns: privacy.legacyOrderColumns,
      count: privacy.legacyOrderColumns.length,
    });
  }
  if (privacy.nonPrivateOrderSideRows > 0) {
    issues.push({
      severity: "BLOCKING",
      code: "ORDER_SIDE_PLAINTEXT_ROWS",
      message: "Order rows must store side as PRIVATE, not BUY or SELL.",
      count: privacy.nonPrivateOrderSideRows,
    });
  }
  if (privacy.agentAccessTokenHashInvalidRows > 0) {
    issues.push({
      severity: "BLOCKING",
      code: "AGENT_ACCESS_TOKEN_HASH_INVALID",
      message: "Agent access tokens must be stored only as sha256 hashes.",
      count: privacy.agentAccessTokenHashInvalidRows,
    });
  }
  if (privacy.residue.agentSubmitOrderTaskRows > 0) {
    issues.push({
      severity: "WARNING",
      code: "AGENT_TASK_PRIVATE_RESIDUE",
      message: "Historical agent task payload/result rows contain private request residue and should be scrubbed.",
      count: privacy.residue.agentSubmitOrderTaskRows,
      taskType: "SCRUB_PRIVATE_TASK_DATA",
    });
  }
  if (privacy.residue.taskEventRows > 0) {
    issues.push({
      severity: "WARNING",
      code: "TASK_EVENT_PRIVATE_RESIDUE",
      message: "Historical task event payload rows contain private request residue and should be scrubbed.",
      count: privacy.residue.taskEventRows,
      taskType: "SCRUB_PRIVATE_TASK_DATA",
    });
  }
  if (privacy.residue.workerErrorRows > 0) {
    issues.push({
      severity: "WARNING",
      code: "WORKER_ERROR_PRIVATE_RESIDUE",
      message: "Historical worker error payload rows contain private request residue and should be scrubbed.",
      count: privacy.residue.workerErrorRows,
      taskType: "SCRUB_PRIVATE_TASK_DATA",
    });
  }
  if (privacy.auditObjects && privacy.auditObjects.legacySchemaCount > 0) {
    issues.push({
      severity: "WARNING",
      code: "AUDIT_OBJECT_LEGACY_SCHEMA",
      message: "Recent audit objects include legacy transcript schemas instead of receipt-only v2 objects.",
      count: privacy.auditObjects.legacySchemaCount,
      schema: privacy.auditObjects.issues.find((issue) => issue.code === "LEGACY_AUDIT_SCHEMA")?.schema ?? null,
      taskType: "REPAIR_AUDIT_PRIVACY",
    });
  }
  if (privacy.auditObjects && privacy.auditObjects.forbiddenFieldCount > 0) {
    const issue = privacy.auditObjects.issues.find((candidate) => candidate.code === "AUDIT_PRIVATE_FIELDS");
    issues.push({
      severity: "BLOCKING",
      code: "AUDIT_OBJECT_PRIVATE_FIELDS",
      message: "Recent audit objects contain private transcript fields and must be replaced with receipt-only proofs.",
      count: privacy.auditObjects.forbiddenFieldCount,
      matchId: issue?.matchId,
      batchId: issue?.batchId,
      forbiddenFields: issue?.forbiddenFields,
      schema: issue?.schema ?? null,
      taskType: "REPAIR_AUDIT_PRIVACY",
    });
  }
  if (privacy.auditObjects && privacy.auditObjects.failedCount > 0) {
    issues.push({
      severity: "WARNING",
      code: "AUDIT_OBJECT_PRIVACY_SCAN_FAILED",
      message: "Recent audit objects could not be scanned for privacy posture.",
      count: privacy.auditObjects.failedCount,
      taskType: "REPAIR_AUDIT_PRIVACY",
    });
  }
}

async function findLegacyOrderColumns(db: Db): Promise<string[]> {
  const rows = await executeRows<{ column_name: string }>(db, sql`
    select column_name
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'orders'
      and column_name in (
        'plain_deposit',
        'plain_request',
        'remaining_deposit',
        'remaining_request',
        'base_amount',
        'limit_price',
        'remaining_base'
      )
    order by column_name
  `);
  return rows.map((row) => row.column_name);
}

async function countNonPrivateOrderSides(db: Db, scope: DeploymentScope) {
  return executeCount(db, sql`
    select count(*)::int as value
    from orders
    where chain_id = ${scope.chainId}
      and lower(dex_address) = ${scope.dexAddress}
      and side <> 'PRIVATE'
  `);
}

async function countInvalidAgentAccessTokenHashes(db: Db, scope: DeploymentScope) {
  return executeCount(db, sql`
    select count(*)::int as value
    from agent_access_tokens
    where chain_id = ${scope.chainId}
      and lower(dex_address) = ${scope.dexAddress}
      and token_hash !~ '^sha256:[0-9a-f]{64}$'
  `);
}

async function countExpiredActiveAccessTokens(db: Db, scope: DeploymentScope) {
  return executeCount(db, sql`
    select count(*)::int as value
    from agent_access_tokens
    where chain_id = ${scope.chainId}
      and lower(dex_address) = ${scope.dexAddress}
      and status = 'ACTIVE'
      and expires_at <= now()
  `);
}

async function executeCount(db: Db, query: ReturnType<typeof sql>): Promise<number> {
  const rows = await executeRows<{ value?: number | string }>(db, query);
  return Number(rows[0]?.value ?? 0);
}

async function executeRows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await (db as any).execute(query);
  if (Array.isArray(result)) return result as T[];
  if (Array.isArray(result?.rows)) return result.rows as T[];
  return [];
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
