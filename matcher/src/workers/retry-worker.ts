import type { Db } from "../db/client.js";
import {
  completeTask,
  failTask,
  leaseTaskForRetry,
  retryableTasks,
  type TaskRow,
  type TaskType,
} from "../tasks/store.js";

export type RetryHandler = (task: TaskRow) => Promise<unknown>;
export type RetryHandlers = Partial<Record<TaskType, RetryHandler>>;

export type RetryWorkerOptions = {
  intervalSec: number;
  leaseSec: number;
  workerId?: string;
  batchSize?: number;
};

export function startRetryWorker(db: Db, handlers: RetryHandlers, options: RetryWorkerOptions) {
  if (options.intervalSec === 0) return;
  const workerId = options.workerId ?? `matcher-retry-${process.pid}`;
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runRetryOnce(db, handlers, { ...options, workerId });
    } catch (error) {
      console.error("retry worker failed:", error instanceof Error ? error.message : String(error));
    } finally {
      running = false;
    }
  }, options.intervalSec * 1000);
}

export async function runRetryOnce(
  db: Db,
  handlers: RetryHandlers,
  options: Required<Pick<RetryWorkerOptions, "leaseSec" | "workerId">> & Pick<RetryWorkerOptions, "batchSize">,
) {
  const now = new Date();
  const rows = await retryableTasks(db, now, options.batchSize ?? 10);
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows) {
    const handler = handlers[row.type as TaskType];
    if (!handler) {
      skipped++;
      continue;
    }
    const lease = await leaseTaskForRetry(db, row.id, {
      owner: options.workerId,
      expiresAt: new Date(now.getTime() + options.leaseSec * 1000),
    }, now);
    if (!lease) {
      skipped++;
      continue;
    }
    try {
      const result = await handler(lease);
      await completeTask(db, lease.id, result, "retry task completed");
      completed++;
    } catch (error) {
      await failTask(db, lease.id, error, "retry task failed");
      failed++;
    }
  }
  return { completed, failed, skipped };
}
