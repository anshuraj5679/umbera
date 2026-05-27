import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { taskEvents, tasks } from "../db/schema.js";

export const taskTypes = [
  "SETUP_ACCOUNT",
  "WRAP_TOKEN",
  "APPROVE_OPERATOR",
  "SUBMIT_ORDER",
  "CANCEL_ORDER",
  "CLOSE_BATCH",
  "MATCH_BATCH",
  "PUBLISH_MATCH",
  "SETTLE_MATCH",
  "VERIFY_AUDIT",
  "CREATE_SESSION_ACCOUNT",
  "WITHDRAW_OR_UNWRAP",
  "AGENT_SUBMIT_ORDER",
] as const;

export type TaskType = (typeof taskTypes)[number];
export type TaskStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type TaskScope = "PUBLIC" | "TRADER" | "AGENT" | "OPERATOR" | "SYSTEM";
export type TaskRow = typeof tasks.$inferSelect;
export type TaskEventRow = typeof taskEvents.$inferSelect;

export class TaskConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "task_already_exists";
  readonly details: { task: ReturnType<typeof publicTaskRow> };

  constructor(readonly task: ReturnType<typeof publicTaskRow>) {
    super(`Task ${task.id} is already ${task.status}.`);
    this.name = "TaskConflictError";
    this.details = { task };
  }
}

export type CreateTaskInput = {
  type: TaskType;
  scope?: TaskScope;
  accountId?: string;
  trader?: string;
  idempotencyKey?: string;
  batchId?: bigint;
  orderId?: bigint;
  matchId?: bigint;
  payload?: unknown;
  maxAttempts?: number;
};

export type TaskLease = {
  owner: string;
  expiresAt: Date;
};

export async function createTask(db: Db, input: CreateTaskInput): Promise<TaskRow> {
  const now = new Date();
  const task: TaskRow = {
    id: randomUUID(),
    type: input.type,
    status: "QUEUED",
    scope: input.scope ?? "SYSTEM",
    accountId: input.accountId ?? null,
    trader: input.trader ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    batchId: input.batchId ?? null,
    orderId: input.orderId ?? null,
    matchId: input.matchId ?? null,
    payload: toJsonValue(input.payload),
    result: null,
    error: null,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    nextRunAt: null,
    heartbeatAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
  };
  await db.insert(tasks).values(task);
  await appendTaskEvent(db, task.id, {
    type: "CREATED",
    status: task.status,
    message: `${task.type} task created`,
  });
  return task;
}

export async function startTask(db: Db, taskId: string, message = "task started") {
  const now = new Date();
  await db.update(tasks)
    .set({
      status: "RUNNING",
      startedAt: now,
      heartbeatAt: now,
      nextRunAt: null,
      attempts: sql`${tasks.attempts} + 1`,
      updatedAt: now,
    })
    .where(eq(tasks.id, taskId));
  await appendTaskEvent(db, taskId, { type: "STARTED", status: "RUNNING", message });
}

export async function completeTask(db: Db, taskId: string, result?: unknown, message = "task completed") {
  const now = new Date();
  await db.update(tasks)
    .set({
      status: "COMPLETED",
      result: toJsonValue(result),
      completedAt: now,
      updatedAt: now,
      heartbeatAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      error: null,
    })
    .where(eq(tasks.id, taskId));
  await appendTaskEvent(db, taskId, {
    type: "COMPLETED",
    status: "COMPLETED",
    message,
    payload: result,
  });
}

export async function failTask(db: Db, taskId: string, error: unknown, message = "task failed") {
  const now = new Date();
  const errorText = errorMessage(error);
  const task = await taskById(db, taskId);
  const nextRunAt = task && task.attempts < task.maxAttempts
    ? new Date(now.getTime() + retryDelayMs(task.attempts))
    : null;
  await db.update(tasks)
    .set({
      status: "FAILED",
      error: errorText,
      nextRunAt,
      heartbeatAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(tasks.id, taskId));
  await appendTaskEvent(db, taskId, {
    type: "FAILED",
    status: "FAILED",
    message,
    payload: { error: errorText },
  });
}

export async function runTask<T>(
  db: Db,
  input: CreateTaskInput,
  fn: (task: TaskRow) => Promise<T>,
): Promise<{ task: TaskRow; result: T; replayed: boolean }> {
  if (input.idempotencyKey) {
    const existing = await taskByIdempotencyKey(db, input.idempotencyKey);
    if (existing) {
      if (existing.status === "COMPLETED" && existing.result !== null) {
        return { task: existing, result: existing.result as T, replayed: true };
      }
      throw new TaskConflictError(publicTaskRow(existing));
    }
  }

  const task = await createTask(db, input);
  await startTask(db, task.id);
  try {
    const result = await fn(task);
    await completeTask(db, task.id, result);
    return { task, result, replayed: false };
  } catch (error) {
    await failTask(db, task.id, error);
    throw error;
  }
}

export async function leaseTaskForRetry(
  db: Db,
  taskId: string,
  lease: TaskLease,
  now = new Date(),
) {
  await db.update(tasks)
    .set({
      status: "RUNNING",
      leaseOwner: lease.owner,
      leaseExpiresAt: lease.expiresAt,
      heartbeatAt: now,
      startedAt: now,
      nextRunAt: null,
      attempts: sql`${tasks.attempts} + 1`,
      updatedAt: now,
    })
    .where(and(
      eq(tasks.id, taskId),
      eq(tasks.status, "FAILED"),
      lt(tasks.attempts, tasks.maxAttempts),
      lte(tasks.nextRunAt, now),
    ));
  const leased = await taskById(db, taskId);
  if (leased?.status !== "RUNNING" || leased.leaseOwner !== lease.owner) return null;
  await appendTaskEvent(db, taskId, {
    type: "LEASED",
    status: "RUNNING",
    message: `task leased to ${lease.owner}`,
    payload: { leaseExpiresAt: lease.expiresAt.toISOString() },
  });
  return leased;
}

export async function appendTaskEvent(
  db: Db,
  taskId: string,
  event: {
    type: string;
    status?: TaskStatus | string;
    message?: string;
    payload?: unknown;
  },
) {
  await db.insert(taskEvents).values({
    taskId,
    type: event.type,
    status: event.status ?? null,
    message: event.message ?? null,
    payload: toJsonValue(event.payload),
  });
}

export async function recentTasks(db: Db, limit: number) {
  return db.select()
    .from(tasks)
    .orderBy(desc(tasks.createdAt))
    .limit(limit);
}

export async function retryableTasks(db: Db, now = new Date(), limit = 20) {
  return db.select()
    .from(tasks)
    .where(and(
      eq(tasks.status, "FAILED"),
      lt(tasks.attempts, tasks.maxAttempts),
      lte(tasks.nextRunAt, now),
    ))
    .orderBy(tasks.nextRunAt, tasks.createdAt)
    .limit(limit);
}

export async function staleRunningTasks(db: Db, olderThan: Date, limit = 20) {
  return db.select()
    .from(tasks)
    .where(and(
      eq(tasks.status, "RUNNING"),
      lte(tasks.heartbeatAt, olderThan),
    ))
    .orderBy(tasks.heartbeatAt, tasks.createdAt)
    .limit(limit);
}

export async function expiredLeasedTasks(db: Db, now = new Date(), limit = 20) {
  return db.select()
    .from(tasks)
    .where(and(
      eq(tasks.status, "RUNNING"),
      lte(tasks.leaseExpiresAt, now),
    ))
    .orderBy(tasks.leaseExpiresAt, tasks.createdAt)
    .limit(limit);
}

export async function taskById(db: Db, taskId: string) {
  const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return rows[0] ?? null;
}

export async function taskByIdempotencyKey(db: Db, idempotencyKey: string) {
  const rows = await db.select().from(tasks).where(eq(tasks.idempotencyKey, idempotencyKey)).limit(1);
  return rows[0] ?? null;
}

export async function taskEventsByTaskId(db: Db, taskId: string) {
  return db.select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(desc(taskEvents.createdAt));
}

export function publicTaskRow(row: TaskRow) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    scope: row.scope,
    batchId: row.batchId?.toString() ?? null,
    orderId: row.orderId?.toString() ?? null,
    matchId: row.matchId?.toString() ?? null,
    error: row.error,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    heartbeatAt: row.heartbeatAt?.toISOString() ?? null,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function publicTaskEventRow(row: TaskEventRow) {
  return {
    id: row.id.toString(),
    taskId: row.taskId,
    type: row.type,
    status: row.status,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  };
}

export function isTaskRetryable(row: Pick<TaskRow, "status" | "attempts" | "maxAttempts" | "nextRunAt">, now = new Date()) {
  return row.status === "FAILED"
    && row.attempts < row.maxAttempts
    && row.nextRunAt !== null
    && row.nextRunAt <= now;
}

export function isTaskStale(row: Pick<TaskRow, "status" | "heartbeatAt">, olderThan: Date) {
  return row.status === "RUNNING"
    && row.heartbeatAt !== null
    && row.heartbeatAt <= olderThan;
}

export function isTaskLeaseExpired(row: Pick<TaskRow, "status" | "leaseExpiresAt">, now = new Date()) {
  return row.status === "RUNNING"
    && row.leaseExpiresAt !== null
    && row.leaseExpiresAt <= now;
}

function toJsonValue(value: unknown) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value, (_key, entry) => {
    if (typeof entry === "bigint") return entry.toString();
    return entry;
  }));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function retryDelayMs(attempts: number) {
  const retryAttempt = Math.max(1, attempts);
  return Math.min(30_000 * 2 ** (retryAttempt - 1), 5 * 60_000);
}
