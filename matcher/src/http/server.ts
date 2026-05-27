import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { Contract } from "ethers";
import type { Db } from "../db/client.js";
import {
  batches as batchesTable,
  consumedNullifiers,
  errors as errorsTable,
  eventCursor,
  indexedBlocks,
  indexedChainLogs,
  matches as matchesTable,
  orderCommitments,
  orders as ordersTable,
  relayerAccounts,
} from "../db/schema.js";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { verifySignedHeader } from "./auth.js";
import type { AgentOrderService } from "../agent/orders.js";
import {
  createSessionAccountSchema,
  publicSessionAccountRow,
  recentSessionAccounts,
  sessionAccountByCommitment,
  upsertSessionAccount,
} from "../accounts/session.js";
import { buildCandles, parseCandleInterval, parseCandleLimit } from "../markets/candles.js";
import { getDeployment } from "../../../shared/addresses/index.js";
import { verifyAuditTranscriptFromS3, type AuditVerificationError } from "../audit/verifier.js";
import { latestRelayerCheckpoint } from "../relayer/commitments.js";
import {
  agentOrderIdempotencyKey,
  hashPrivateValue,
  isSafeErrorDetailKey,
  publicAgentOrderResult,
  redactErrorMessage,
  sanitizeAgentOrderTaskPayload,
  sanitizeWorkerErrorPayload,
} from "../privacy/redaction.js";
import {
  expiredLeasedTasks,
  publicTaskEventRow,
  publicTaskRow,
  recentTasks,
  retryableTasks,
  runTask,
  staleRunningTasks,
  taskById,
  taskEventsByTaskId,
} from "../tasks/store.js";
import { normalizeDexAddress, type DeploymentScope } from "../orders/lifecycle.js";

export type AgentHttpApi = {
  orderService: AgentOrderService;
  paymentMiddleware?: RequestHandler;
  x402Enabled: boolean;
  devBypassToken?: string;
};

export type MatcherHttpContext = {
  dex: Contract;
  dexAddress: string;
  chainId: number;
  pairs: Array<{
    id: number;
    base: { address: string; symbol: string; decimals: number };
    quote: { address: string; symbol: string; decimals: number };
  }>;
  disputeWindowSec: number;
  matchDelaySec: number;
  confirmationDepth: number;
  auditBucket?: string;
  corsOrigins?: string[];
};

export function startHttp(
  port: number,
  db: Db,
  matcherAddress: string,
  onPublish: (batchId: bigint) => Promise<void>,
  agentApi?: AgentHttpApi,
  httpCtx?: MatcherHttpContext,
) {
  const app = express();
  app.use(corsMiddleware(httpCtx?.corsOrigins ?? []));
  app.use(express.json());
  app.get("/health", async (_req, res) => {
    const health = await buildHealth(db, matcherAddress, httpCtx);
    res.status(health.ok ? 200 : 503).json(health);
  });
  app.get("/markets", (_req, res) => {
    const chainId = httpCtx?.chainId ?? 421614;
    const pairs = httpCtx?.pairs ?? getDeployment(chainId).pairs;
    res.json({
      chainId,
      markets: pairs.map((pair) => ({
        pairId: pair.id,
        base: pair.base,
        quote: pair.quote,
        label: `${stripEncryptedPrefix(pair.quote.symbol)} / ${stripEncryptedPrefix(pair.base.symbol)}`,
      })),
    });
  });
  app.get("/agent/capabilities", (_req, res) => {
    if (!agentApi) return res.json({ ok: true, enabled: false });
    res.json(agentApi.orderService.capabilities());
  });
  if (agentApi) {
    const middlewares = [
      agentApi.paymentMiddleware,
      requireAgentAccess(agentApi),
    ].filter(Boolean) as RequestHandler[];
    app.post("/agent/orders", ...middlewares, async (req, res) => {
      try {
        const { task, result, replayed } = await runTask(db, {
          type: "AGENT_SUBMIT_ORDER",
          scope: "AGENT",
          idempotencyKey: typeof req.body?.clientOrderId === "string"
            ? agentOrderIdempotencyKey(req.body.clientOrderId, process.env.AGENT_ORDER_IDEMPOTENCY_SECRET)
            : undefined,
          payload: sanitizeAgentOrderTaskPayload(req.body, process.env.AGENT_ORDER_IDEMPOTENCY_SECRET),
        }, async () => publicAgentOrderResult(await agentApi.orderService.submit(req.body)));
        res.status(replayed ? 200 : 201).json({
          ...result,
          taskId: task.id,
          replayed,
          paymentMode: agentApi.x402Enabled ? "x402" : "dev-bypass",
        });
      } catch (error) {
        sendAgentOrderError(res, error);
      }
    });
  }
  app.get("/orders", async (req, res) => {
    const batchId = parseBigIntParam(req.query.batchId);
    if (batchId === null) return res.status(400).json({ error: "batchId query parameter is required" });
    const rows = await db.select().from(ordersTable).where(withScope(ordersTable, httpCtx, eq(ordersTable.batchId, batchId)));
    res.json(rows.map(publicOrderRow));
  });
  app.get("/batches/recent", async (req, res) => {
    const limit = parsePositiveInteger(req.query.limit, 20, 100);
    const rows = await db.select()
      .from(batchesTable)
      .where(scopeWhere(batchesTable, httpCtx))
      .orderBy(desc(batchesTable.id))
      .limit(limit);
    const batches = await Promise.all(rows.map(async (row) => {
      const [indexedOrders, matchCount, onChainOrders] = await Promise.all([
        countOrdersForBatch(db, row.id, httpCtx),
        countMatchesForBatch(db, row.id, httpCtx),
        httpCtx ? readBatchOrderCount(httpCtx.dex, row.id).catch(() => null) : Promise.resolve(null),
      ]);
      return {
        id: row.id.toString(),
        status: row.status,
        openedAt: row.openedAt.toISOString(),
        closedAt: row.closedAt?.toISOString() ?? null,
        settledAt: row.settledAt?.toISOString() ?? null,
        closeTxHash: row.closeTxHash,
        indexedOrderCount: indexedOrders.toString(),
        onChainOrderCount: onChainOrders?.toString() ?? null,
        matchCount: matchCount.toString(),
      };
    }));
    res.json({ batches });
  });
  app.get("/tasks/recent", async (req, res) => {
    const limit = parsePositiveInteger(req.query.limit, 20, 100);
    const rows = await recentTasks(db, limit);
    res.json({ tasks: rows.map(publicTaskRow) });
  });
  app.get("/tasks/:id", async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "missing id" });
    const row = await taskById(db, id);
    if (!row) return res.status(404).end();
    const events = await taskEventsByTaskId(db, id);
    res.json({ task: publicTaskRow(row), events: events.map(publicTaskEventRow) });
  });
  app.get("/session-accounts/recent", async (req, res) => {
    const limit = parsePositiveInteger(req.query.limit, 20, 100);
    const rows = await recentSessionAccounts(db, limit);
    res.json({ accounts: rows.map(publicSessionAccountRow) });
  });
  app.get("/session-accounts/:accountCommitment", async (req, res) => {
    const accountCommitment = req.params.accountCommitment;
    if (!accountCommitment || !/^0x[0-9a-fA-F]{64}$/.test(accountCommitment)) {
      return res.status(400).json({ error: "invalid accountCommitment", code: "invalid_account_commitment" });
    }
    const row = await sessionAccountByCommitment(db, accountCommitment);
    if (!row) return res.status(404).end();
    res.json(publicSessionAccountRow(row));
  });
  app.get("/matches/:id", async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "missing id" });
    const r = await db.select().from(matchesTable).where(scopedIdWhere(matchesTable, httpCtx, BigInt(id))).then((rs: any[]) => rs[0]);
    if (!r) return res.status(404).end();
    res.json(publicMatchRow(r));
  });
  app.get("/matches/:id/audit", async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "missing id" });
    if (!httpCtx?.auditBucket) {
      return res.status(503).json({ error: "audit verifier is not configured", code: "audit_verifier_unconfigured" });
    }
    const match = await db.select().from(matchesTable).where(scopedIdWhere(matchesTable, httpCtx, BigInt(id))).limit(1).then((rs: any[]) => rs[0]);
    if (!match) return res.status(404).json({ error: "match not found", code: "match_not_found" });
    if (!match.auditS3Key) return res.status(404).json({ error: "match has no audit transcript", code: "audit_transcript_missing" });
    try {
      const verification = await verifyAuditTranscriptFromS3({
        bucket: httpCtx.auditBucket,
        key: match.auditS3Key,
        match,
        matcherAddress,
      });
      res.json(publicAuditVerificationRow(verification));
    } catch (error) {
      sendAuditVerificationError(res, error);
    }
  });
  app.post("/operator/audits/:matchId/verify", verifySignedHeader(matcherAddress), async (req, res) => {
    const matchId = parseBigIntParam(req.params.matchId);
    if (matchId === null) return res.status(400).json({ error: "invalid matchId", code: "invalid_match_id" });
    if (!httpCtx?.auditBucket) {
      return res.status(503).json({ error: "audit verifier is not configured", code: "audit_verifier_unconfigured" });
    }
    const match = await db.select().from(matchesTable).where(scopedIdWhere(matchesTable, httpCtx, matchId)).limit(1).then((rs: any[]) => rs[0]);
    if (!match) return res.status(404).json({ error: "match not found", code: "match_not_found" });
    if (!match.auditS3Key) {
      return res.status(404).json({ error: "match has no audit transcript", code: "audit_transcript_missing" });
    }

    try {
      const { task, result, replayed } = await runTask(db, {
        type: "VERIFY_AUDIT",
        scope: "OPERATOR",
        idempotencyKey: `operator:verify-audit:${matchId.toString()}:${match.auditS3Key}`,
        batchId: match.batchId,
        matchId,
        payload: { auditS3Key: match.auditS3Key },
      }, async () => ({
        verification: await verifyAuditTranscriptFromS3({
          bucket: httpCtx.auditBucket!,
          key: match.auditS3Key!,
          match,
          matcherAddress,
        }),
      }));
      res.json({ ...result, taskId: task.id, replayed });
    } catch (error) {
      sendAuditVerificationError(res, error);
    }
  });
  app.get("/operator/indexer/status", verifySignedHeader(matcherAddress), async (_req, res) => {
    res.json(await buildIndexerStatus(db, httpCtx));
  });
  app.get("/operator/relayer/state", verifySignedHeader(matcherAddress), async (_req, res) => {
    res.json(await buildRelayerStateStatus(db, httpCtx));
  });
  app.post("/operator/session-accounts", verifySignedHeader(matcherAddress), async (req, res) => {
    const parsed = createSessionAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid session account request",
        code: "invalid_session_account_request",
        details: parsed.error.flatten(),
      });
    }
    try {
      const { task, result, replayed } = await runTask(db, {
        type: "CREATE_SESSION_ACCOUNT",
        scope: "OPERATOR",
        payload: sanitizeSessionAccountTaskPayload(req.body),
      }, async () => ({
        account: publicSessionAccountRow(await upsertSessionAccount(db, parsed.data, {
          chainId: httpCtx?.chainId ?? 421614,
          dexAddress: httpCtx?.dexAddress ?? getDeployment(httpCtx?.chainId ?? 421614).dex,
        })),
      }));
      res.status(replayed ? 200 : 201).json({ ...result, taskId: task.id, replayed });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: redactErrorMessage(message), code: "session_account_create_failed" });
    }
  });
  app.get("/markets/:pairId/candles", async (req, res) => {
    const pairId = Number(req.params.pairId);
    if (!Number.isInteger(pairId) || pairId < 0) {
      return res.status(400).json({ error: "invalid pairId" });
    }

    const interval = parseCandleInterval(req.query.interval);
    const limit = parseCandleLimit(req.query.limit);
    const rows = await db.select()
      .from(matchesTable)
      .where(withScope(matchesTable, httpCtx, eq(matchesTable.pairId, pairId), eq(matchesTable.status, "SETTLED")))
      .orderBy(desc(matchesTable.settledAt))
      .limit(Math.min(limit * 100, 5_000));
    const decimals = pairDecimals(pairId, httpCtx);
    const candles = buildCandles(rows, interval, limit, decimals);
    res.json({ pairId, interval, candles });
  });
  app.post("/publish/:batchId", verifySignedHeader(matcherAddress), async (req, res) => {
    const batchId = req.params.batchId;
    if (!batchId) return res.status(400).json({ error: "missing batchId" });
    try {
      const parsedBatchId = BigInt(batchId);
      const { task, result, replayed } = await runTask(db, {
        type: "MATCH_BATCH",
        scope: "OPERATOR",
        batchId: parsedBatchId,
        payload: { source: "http_publish" },
      }, async () => {
        await onPublish(parsedBatchId);
        return { ok: true, batchId };
      });
      res.json({ ...result, taskId: task.id, replayed });
    }
    catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  return app.listen(port, () => console.log(`http :${port}`));
}

async function buildHealth(db: Db, matcherAddress: string, httpCtx?: MatcherHttpContext) {
  const startedAt = process.uptime();
  const health: any = {
    ok: true,
    service: "darkpool-matcher",
    uptimeSec: Math.floor(startedAt),
    chainId: httpCtx?.chainId ?? 421614,
    matcher: {
      configuredAddress: matcherAddress,
      onChainAddress: null,
      roleOk: null,
    },
    db: { ok: false },
    indexer: {
      latestIndexedBlock: null,
      latestConfirmedBlock: null,
      chainHeadBlock: null,
      lagBlocks: null,
      confirmationDepth: httpCtx?.confirmationDepth ?? null,
      reorgedLogCount: 0,
    },
    relayerState: null,
    currentBatch: null,
    closedBatchesWaitingForMatch: [],
    pendingMatchesPastDisputeWindow: [],
    recentWorkerErrors: [],
    recentTasks: [],
    retryableTasks: [],
    staleRunningTasks: [],
    expiredLeases: [],
    config: {
      matchDelaySec: httpCtx?.matchDelaySec ?? null,
      disputeWindowSec: httpCtx?.disputeWindowSec ?? null,
    },
  };

  try {
    const [cursor, latestConfirmed, reorgCount, checkpoint, sessionAccountCount] = await Promise.all([
      db.select().from(eventCursor).where(eq(eventCursor.component, "matcher")).limit(1),
      db.select().from(indexedBlocks).where(scopeWhere(indexedBlocks, httpCtx)).orderBy(desc(indexedBlocks.blockNumber)).limit(1),
      db.select({ value: sql<number>`count(*)::int` })
        .from(indexedChainLogs)
        .where(withScope(indexedChainLogs, httpCtx, eq(indexedChainLogs.confirmationStatus, "REORGED")))
        .then((rows) => rows[0]),
      latestRelayerCheckpoint(db),
      db.select({ value: sql<number>`count(*)::int` }).from(relayerAccounts).where(scopeWhere(relayerAccounts, httpCtx)).then((rows) => rows[0]?.value ?? 0),
    ]);
    health.db.ok = true;
    health.indexer.latestIndexedBlock = cursor[0]?.lastBlock?.toString() ?? null;
    health.indexer.latestConfirmedBlock = latestConfirmed[0]?.blockNumber?.toString() ?? null;
    health.indexer.reorgedLogCount = reorgCount?.value ?? 0;
    health.relayerState = {
      latestCheckpoint: checkpoint ? publicRelayerCheckpointRow(checkpoint) : null,
      sessionAccountCount,
    };
  } catch (error) {
    health.db.error = errorMessage(error);
    health.ok = false;
  }

  if (httpCtx) {
    try {
      const [onChainMatcher, headBlock, block, currentBatch] = await Promise.all([
        (httpCtx.dex as any).matcher(),
        httpCtx.dex.runner!.provider!.getBlockNumber(),
        httpCtx.dex.runner!.provider!.getBlock("latest"),
        (httpCtx.dex as any).getCurrentBatch(),
      ]);
      health.matcher.onChainAddress = String(onChainMatcher);
      health.matcher.roleOk = String(onChainMatcher).toLowerCase() === matcherAddress.toLowerCase();
      health.indexer.chainHeadBlock = headBlock;
      health.indexer.lagBlocks = health.indexer.latestIndexedBlock === null
        ? null
        : Math.max(0, headBlock - Number(health.indexer.latestIndexedBlock));

      const batchId = BigInt((currentBatch.batchId ?? currentBatch[0]).toString());
      const openedAt = BigInt((currentBatch.openedAt ?? currentBatch[1]).toString());
      const isOpen = Boolean(currentBatch.isOpen ?? currentBatch[2]);
      const onChainOrderCount = BigInt((currentBatch.orderCount ?? currentBatch[3]).toString());
      const indexedOrderCount = health.db.ok ? await countOrdersForBatch(db, batchId, httpCtx) : null;
      health.currentBatch = {
        id: batchId.toString(),
        status: isOpen ? "OPEN" : "CLOSED",
        openedAt: new Date(Number(openedAt) * 1000).toISOString(),
        onChainOrderCount: onChainOrderCount.toString(),
        indexedOrderCount: indexedOrderCount?.toString() ?? null,
        blockTimestamp: block?.timestamp ?? null,
      };

      if (!health.matcher.roleOk) health.ok = false;
    } catch (error) {
      health.matcher.error = errorMessage(error);
      health.ok = false;
    }
  }

  if (health.db.ok) {
    try {
      const closedRows = await db.select()
        .from(batchesTable)
        .where(withScope(batchesTable, httpCtx, eq(batchesTable.status, "CLOSED")))
        .orderBy(desc(batchesTable.closedAt), desc(batchesTable.id))
        .limit(10);
      health.closedBatchesWaitingForMatch = await Promise.all(closedRows.map(async (row) => {
        const [indexedOrderCount, onChainOrderCount] = await Promise.all([
          countOrdersForBatch(db, row.id, httpCtx),
          httpCtx ? readBatchOrderCount(httpCtx.dex, row.id).catch(() => null) : Promise.resolve(null),
        ]);
        return {
          id: row.id.toString(),
          closedAt: row.closedAt?.toISOString() ?? null,
          indexedOrderCount: indexedOrderCount.toString(),
          onChainOrderCount: onChainOrderCount?.toString() ?? null,
          closeTxHash: row.closeTxHash,
        };
      }));
    } catch (error) {
      health.closedBatchError = errorMessage(error);
    }

    try {
      const pending = await db.select()
        .from(matchesTable)
        .where(withScope(matchesTable, httpCtx, eq(matchesTable.status, "PENDING")))
        .orderBy(desc(matchesTable.publishedAt))
        .limit(50);
      const nowSec = Math.floor(Date.now() / 1000);
      health.pendingMatchesPastDisputeWindow = pending
        .filter((row) => row.publishedAt && httpCtx && (row.publishedAt.getTime() / 1000) + httpCtx.disputeWindowSec <= nowSec)
        .slice(0, 10)
        .map((row) => ({
          id: row.id.toString(),
          batchId: row.batchId.toString(),
          pairId: row.pairId,
          publishedAt: row.publishedAt?.toISOString() ?? null,
          publishTxHash: row.publishTxHash,
        }));
    } catch (error) {
      health.pendingSettlementError = errorMessage(error);
    }

    try {
      const errors = await db.select()
        .from(errorsTable)
        .where(isNull(errorsTable.resolvedAt))
        .orderBy(desc(errorsTable.occurredAt))
        .limit(10);
      health.recentWorkerErrors = errors.map((row) => ({
        id: row.id.toString(),
        component: row.component,
        payload: sanitizeWorkerErrorPayload(row.payload),
        occurredAt: row.occurredAt.toISOString(),
      }));
    } catch (error) {
      health.workerErrorReadError = errorMessage(error);
    }

    try {
      const tasks = await recentTasks(db, 10);
      health.recentTasks = tasks.map(publicTaskRow);
    } catch (error) {
      health.taskReadError = errorMessage(error);
    }

    try {
      const now = new Date();
      const staleBefore = new Date(now.getTime() - 5 * 60_000);
      const [retryable, stale, expired] = await Promise.all([
        retryableTasks(db, now, 10),
        staleRunningTasks(db, staleBefore, 10),
        expiredLeasedTasks(db, now, 10),
      ]);
      health.retryableTasks = retryable.map(publicTaskRow);
      health.staleRunningTasks = stale.map(publicTaskRow);
      health.expiredLeases = expired.map(publicTaskRow);
      if (stale.length > 0 || expired.length > 0) health.ok = false;
    } catch (error) {
      health.taskHealthReadError = errorMessage(error);
    }
  }

  return health;
}

function corsMiddleware(allowedOrigins: string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.header("origin");
    if (origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin))) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Headers", "content-type, authorization, x-agent-bypass-token, x-signature, x-message, x-darkpool-signature, x-darkpool-address, x-darkpool-timestamp");
      res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  };
}

async function countOrdersForBatch(db: Db, batchId: bigint, httpCtx?: MatcherHttpContext): Promise<bigint> {
  const row = await db.select({ value: sql<number>`count(*)::int` })
    .from(ordersTable)
    .where(withScope(ordersTable, httpCtx, eq(ordersTable.batchId, batchId)))
    .then((rows) => rows[0]);
  return BigInt(row?.value ?? 0);
}

async function countMatchesForBatch(db: Db, batchId: bigint, httpCtx?: MatcherHttpContext): Promise<bigint> {
  const row = await db.select({ value: sql<number>`count(*)::int` })
    .from(matchesTable)
    .where(withScope(matchesTable, httpCtx, eq(matchesTable.batchId, batchId)))
    .then((rows) => rows[0]);
  return BigInt(row?.value ?? 0);
}

async function readBatchOrderCount(dex: Contract, batchId: bigint): Promise<bigint> {
  const value = await (dex as any).batchOrderCount(batchId);
  return BigInt(value.toString());
}

function parseBigIntParam(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function parsePositiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function stripEncryptedPrefix(symbol: string) {
  return symbol.replace(/^e/, "");
}

function pairDecimals(pairId: number, httpCtx?: MatcherHttpContext) {
  const chainId = httpCtx?.chainId ?? 421614;
  const pair = (httpCtx?.pairs ?? getDeployment(chainId).pairs).find((candidate) => candidate.id === pairId);
  return pair ? { cash: pair.base.decimals, asset: pair.quote.decimals } : undefined;
}

function activeScope(httpCtx?: MatcherHttpContext): DeploymentScope | null {
  if (!httpCtx) return null;
  return {
    chainId: httpCtx.chainId,
    dexAddress: normalizeDexAddress(httpCtx.dexAddress),
  };
}

function scopeWhere(table: { chainId: any; dexAddress: any }, httpCtx?: MatcherHttpContext) {
  const scope = activeScope(httpCtx);
  if (!scope) return sql`true`;
  return and(
    eq(table.chainId, scope.chainId),
    sql`lower(${table.dexAddress}) = ${scope.dexAddress}`,
  );
}

function withScope(table: { chainId: any; dexAddress: any }, httpCtx?: MatcherHttpContext, ...conditions: any[]) {
  return and(scopeWhere(table, httpCtx), ...conditions);
}

function scopedIdWhere(table: { chainId: any; dexAddress: any; id: any }, httpCtx: MatcherHttpContext | undefined, id: bigint) {
  return withScope(table, httpCtx, eq(table.id, id));
}

async function buildIndexerStatus(db: Db, httpCtx?: MatcherHttpContext) {
  const [cursor, latestBlock, reorgCount] = await Promise.all([
    db.select().from(eventCursor).where(eq(eventCursor.component, "matcher")).limit(1).then((rows) => rows[0] ?? null),
    db.select().from(indexedBlocks).where(scopeWhere(indexedBlocks, httpCtx)).orderBy(desc(indexedBlocks.blockNumber)).limit(1).then((rows) => rows[0] ?? null),
    db.select({ value: sql<number>`count(*)::int` })
      .from(indexedChainLogs)
      .where(withScope(indexedChainLogs, httpCtx, eq(indexedChainLogs.confirmationStatus, "REORGED")))
      .then((rows) => rows[0]?.value ?? 0),
  ]);
  return {
    chainId: httpCtx?.chainId ?? 421614,
    dexAddress: httpCtx?.dexAddress ?? null,
    confirmationDepth: httpCtx?.confirmationDepth ?? null,
    latestIndexedBlock: cursor?.lastBlock?.toString() ?? null,
    latestConfirmedBlock: latestBlock?.blockNumber?.toString() ?? null,
    latestConfirmedBlockHash: latestBlock?.blockHash ?? null,
    reorgedLogCount: reorgCount,
  };
}

async function buildRelayerStateStatus(db: Db, httpCtx?: MatcherHttpContext) {
  const [checkpoint, commitmentCount, consumedCount, accountCount] = await Promise.all([
    latestRelayerCheckpoint(db),
    db.select({ value: sql<number>`count(*)::int` }).from(orderCommitments).where(scopeWhere(orderCommitments, httpCtx)).then((rows) => rows[0]?.value ?? 0),
    db.select({ value: sql<number>`count(*)::int` }).from(consumedNullifiers).then((rows) => rows[0]?.value ?? 0),
    db.select({ value: sql<number>`count(*)::int` }).from(relayerAccounts).where(scopeWhere(relayerAccounts, httpCtx)).then((rows) => rows[0]?.value ?? 0),
  ]);
  return {
    chainId: httpCtx?.chainId ?? 421614,
    dexAddress: httpCtx?.dexAddress ?? null,
    latestCheckpoint: checkpoint ? publicRelayerCheckpointRow(checkpoint) : null,
    orderCommitmentCount: commitmentCount,
    consumedNullifierCount: consumedCount,
    sessionAccountCount: accountCount,
  };
}

export function publicAuditVerificationRow(verification: Awaited<ReturnType<typeof verifyAuditTranscriptFromS3>>) {
  return {
    ok: verification.ok,
    matchId: verification.matchId,
    digestOk: verification.digest.ok,
    signatureOk: verification.signature.ok,
    fieldsOk: Object.values(verification.fields).every(Boolean),
    auctionOk: verification.auction.ok,
    auctionRecomputed: verification.auction.recomputed,
    transcript: verification.transcript,
  };
}

function publicRelayerCheckpointRow(row: {
  id: bigint;
  confirmedBlock: bigint;
  confirmedBlockHash: string;
  stateRoot: string;
  orderCommitmentCount: number;
  consumedNullifierCount: number;
  createdAt: Date;
}) {
  return {
    id: row.id.toString(),
    confirmedBlock: row.confirmedBlock.toString(),
    confirmedBlockHash: row.confirmedBlockHash,
    stateRoot: row.stateRoot,
    orderCommitmentCount: row.orderCommitmentCount,
    consumedNullifierCount: row.consumedNullifierCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function publicOrderRow(row: any) {
  return {
    id: row.id.toString(),
    pairId: row.pairId,
    batchId: row.batchId.toString(),
    trader: row.accountCommitment ? null : row.trader,
    accountCommitment: row.accountCommitment ?? null,
    status: row.status,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    expiry: row.expiry.toString(),
    submitTxHash: row.submitTxHash,
  };
}

export function publicMatchRow(row: any) {
  const a = BigInt(row.buyOrderId);
  const b = BigInt(row.sellOrderId);
  const [orderAId, orderBId] = a < b ? [a, b] : [b, a];
  return {
    id: row.id.toString(),
    batchId: row.batchId.toString(),
    pairId: row.pairId,
    orderAId: orderAId.toString(),
    orderBId: orderBId.toString(),
    status: row.status,
    publishedAt: row.publishedAt instanceof Date ? row.publishedAt.toISOString() : row.publishedAt,
    settledAt: row.settledAt instanceof Date ? row.settledAt.toISOString() : row.settledAt,
    publishTxHash: row.publishTxHash,
    settleTxHash: row.settleTxHash,
  };
}

function requireAgentAccess(agentApi: AgentHttpApi): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (agentApi.x402Enabled) return next();
    if (!agentApi.devBypassToken) {
      return res.status(503).json({
        error: "agent order API is not enabled",
        code: "agent_api_disabled",
      });
    }
    if (req.header("x-agent-bypass-token") !== agentApi.devBypassToken) {
      return res.status(401).json({
        error: "x-agent-bypass-token required",
        code: "agent_bypass_required",
      });
    }
    next();
  };
}

function sendAgentOrderError(res: Response, error: unknown) {
  if (isAgentOrderError(error)) {
    return res.status(error.statusCode).json({
      error: redactErrorMessage(error.message),
      code: error.code,
      details: sanitizeAgentErrorDetails(error.details),
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return res.status(500).json({ error: message, code: "agent_order_failed" });
}

function sendAuditVerificationError(res: Response, error: unknown) {
  if (isAuditVerificationError(error)) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
  }
  if (isAgentOrderError(error)) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      details: error.details,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return res.status(500).json({ error: message, code: "audit_verification_failed" });
}

function isAuditVerificationError(error: unknown): error is AuditVerificationError {
  return error instanceof Error
    && typeof (error as Error & { statusCode?: unknown }).statusCode === "number"
    && typeof (error as Error & { code?: unknown }).code === "string"
    && error.name === "AuditVerificationError";
}

function isAgentOrderError(error: unknown): error is {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
} {
  if (!(error instanceof Error)) return false;
  const candidate = error as Error & { statusCode?: unknown; code?: unknown };
  return typeof candidate.statusCode === "number" && typeof candidate.code === "string";
}

function sanitizeAgentErrorDetails(details: unknown) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const source = details as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!isSafeErrorDetailKey(key)) continue;
    out[key] = typeof value === "string" ? redactErrorMessage(value) : value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeSessionAccountTaskPayload(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { requestShape: "invalid" };
  const body = input as Record<string, unknown>;
  return {
    requestShape: "session_account",
    chainId: safeInteger(body.chainId),
    dexAddressHash: typeof body.dexAddress === "string" ? hashPrivateValue(body.dexAddress) : null,
    sessionPublicKeyHash: typeof body.sessionPublicKey === "string" ? hashPrivateValue(body.sessionPublicKey) : null,
    hasOwnerCommitment: typeof body.ownerCommitment === "string",
    hasOwnerAddress: typeof body.ownerAddress === "string",
    hasLabel: typeof body.label === "string" && body.label.trim().length > 0,
    labelHash: typeof body.label === "string" ? hashPrivateValue(body.label) : null,
    createdTxHash: typeof body.createdTxHash === "string" ? body.createdTxHash : null,
  };
}

function safeInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
