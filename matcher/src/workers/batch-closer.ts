import cron from "node-cron";
import type { Contract } from "ethers";
import type { Db } from "../db/client.js";
import { runTask } from "../tasks/store.js";

export type BatchCloserOptions = {
  emptyBatchCloseAfterSec: number;
  db?: Db;
  chainId?: number;
  dexAddress?: string;
};

export function startBatchCloser(
  dex: Contract,
  onClosed?: (ev: any) => Promise<void>,
  opts: BatchCloserOptions = { emptyBatchCloseAfterSec: 900 }
) {
  let running = false;
  let lastEmptySkipLog: string | null = null;
  cron.schedule("*/15 * * * * *", async () => {
    if (running) return;
    running = true;
    try {
      const cur = await (dex as any).getCurrentBatch();
      const dur = Number(await (dex as any).batchDuration());
      const block = await dex.runner!.provider!.getBlock("latest");
      const now = Number(block?.timestamp ?? Math.floor(Date.now() / 1000));
      if (cur.isOpen && now >= Number(cur.openedAt) + dur) {
        const orderCount = Number(cur.orderCount ?? cur[3] ?? 0);
        const batchId = String(cur.batchId ?? cur[0]);
        const emptyCloseDelay = opts.emptyBatchCloseAfterSec;
        if (orderCount === 0 && (emptyCloseDelay === 0 || now < Number(cur.openedAt) + emptyCloseDelay)) {
          if (lastEmptySkipLog !== batchId) {
            console.log("empty batch close deferred", batchId);
            lastEmptySkipLog = batchId;
          }
          return;
        }

        const close = async () => {
          const result = await closeBatchIfReady(dex, BigInt(batchId), onClosed);
          lastEmptySkipLog = null;
          return { ...result, orderCount };
        };

        if (opts.db) {
          await runTask(opts.db, {
            type: "CLOSE_BATCH",
            scope: "SYSTEM",
            batchId: BigInt(batchId),
            idempotencyKey: opts.chainId && opts.dexAddress ? `close:${opts.chainId}:${opts.dexAddress}:${batchId}` : undefined,
            payload: { orderCount },
          }, close);
        } else {
          await close();
        }
      }
    } catch (e) { console.error("close failed", e); }
    finally { running = false; }
  });
}

export async function closeBatchIfReady(
  dex: Contract,
  batchId: bigint,
  onClosed?: (ev: any) => Promise<void>,
) {
  const cur = await (dex as any).getCurrentBatch();
  const currentBatchId = BigInt((cur.batchId ?? cur[0]).toString());
  if (currentBatchId > batchId) {
    return { ok: true, batchId: batchId.toString(), txHash: null, alreadyClosed: true };
  }
  if (currentBatchId < batchId) {
    throw new Error(`cannot close future batch ${batchId.toString()} while current batch is ${currentBatchId.toString()}`);
  }

  await (dex as any).closeBatch.staticCall();
  const tx = await (dex as any).closeBatch();
  const rcpt = await tx.wait();
  console.log("batch closed", batchId.toString());
  const closedLog = rcpt.logs.find((l: any) => l.fragment?.name === "BatchClosed");
  if (closedLog && onClosed) await onClosed(closedLog);
  return { ok: true, batchId: batchId.toString(), txHash: rcpt.hash, alreadyClosed: false };
}
