import type { Contract } from "ethers";
import type { Db } from "../db/client.js";
import { buildInvariantReport, enqueueInvariantRepairs } from "../ops/invariants.js";
import { recoverStaleRunningTasks } from "../tasks/store.js";
import { errorMessage, recordWorkerError, workerErrorPayload } from "./errors.js";

export type InvariantReconcilerOptions = {
  intervalSec: number;
  dex: Contract;
  chainId: number;
  dexAddress: string;
  disputeWindowSec: number;
  auditBucket?: string;
  requireBatchProofAnchorForSettlement?: boolean;
  indexerMaxLagBlocks?: number;
  limit?: number;
};

export type StaleTaskRecoveryOptions = {
  intervalSec: number;
  staleAfterSec: number;
  limit?: number;
};

export function startInvariantReconciler(db: Db, options: InvariantReconcilerOptions) {
  if (options.intervalSec <= 0) return;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const result = await runInvariantReconcileOnce(db, options);
      if (result.repairs.enqueued.length > 0 || !result.report.ok) {
        console.log("invariant reconcile", {
          ok: result.report.ok,
          blocking: result.report.blockingCount,
          warnings: result.report.warningCount,
          enqueued: result.repairs.enqueued.length,
        });
      }
    } catch (error) {
      console.error("invariant reconcile failed:", errorMessage(error));
      await recordWorkerError(db, "invariant-reconciler", workerErrorPayload(error));
    } finally {
      running = false;
    }
  }, options.intervalSec * 1000);
  timer.unref?.();
}

export async function runInvariantReconcileOnce(db: Db, options: Omit<InvariantReconcilerOptions, "intervalSec">) {
  const report = await buildInvariantReport(db, {
    dex: options.dex,
    chainId: options.chainId,
    dexAddress: options.dexAddress,
    disputeWindowSec: options.disputeWindowSec,
    auditBucket: options.auditBucket,
    requireBatchProofAnchorForSettlement: options.requireBatchProofAnchorForSettlement,
    indexerMaxLagBlocks: options.indexerMaxLagBlocks,
    limit: options.limit ?? 25,
  });
  const repairs = await enqueueInvariantRepairs(db, report);
  return { report, repairs };
}

export function startStaleTaskRecovery(db: Db, options: StaleTaskRecoveryOptions) {
  if (options.intervalSec <= 0) return;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const result = await runStaleTaskRecoveryOnce(db, options);
      if (result.recovered > 0) {
        console.log("stale task recovery", result);
      }
    } catch (error) {
      console.error("stale task recovery failed:", errorMessage(error));
      await recordWorkerError(db, "stale-task-recovery", workerErrorPayload(error));
    } finally {
      running = false;
    }
  }, options.intervalSec * 1000);
  timer.unref?.();
}

export async function runStaleTaskRecoveryOnce(db: Db, options: Omit<StaleTaskRecoveryOptions, "intervalSec">) {
  const now = new Date();
  return recoverStaleRunningTasks(db, {
    now,
    staleBefore: new Date(now.getTime() - options.staleAfterSec * 1000),
    limit: options.limit ?? 25,
  });
}
