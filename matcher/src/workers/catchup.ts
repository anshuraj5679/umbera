import type { Contract } from "ethers";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  batches,
  eventCursor,
  indexedBlocks,
  indexedChainLogs,
  matches,
  orderCommitments,
  orders,
} from "../db/schema.js";
import { createRelayerCheckpoint } from "../relayer/commitments.js";

const EVENT_NAMES = ["OrderSubmitted", "OrderSubmittedPrivate", "BatchClosed", "MatchPublished", "MatchDisputed", "MatchSettled"];
const MAX_QUERY_ATTEMPTS = 5;

export type CatchupOptions = {
  chainId: number;
  dexAddress: string;
  chunkSize?: number;
  confirmationDepth?: number;
  checkpointEveryChunk?: boolean;
};

export async function catchup(
  dex: Contract,
  db: Db,
  fromDefault: number,
  replay: (ev: any) => Promise<void>,
  options: CatchupOptions,
) {
  const chunkSize = options.chunkSize ?? 500;
  const confirmationDepth = options.confirmationDepth ?? 12;
  await rollbackIfNeeded(dex, db, options);

  const cur = await db.select().from(eventCursor).where(eq(eventCursor.component, "matcher")).then((r: any[]) => r[0]);
  const head = await dex.runner!.provider!.getBlockNumber();
  const confirmedHead = Math.max(0, head - confirmationDepth);
  const fromBlock = cur ? Number(cur.lastBlock) + 1 : fromDefault;

  if (confirmedHead < fromBlock) return;

  console.log(`confirmed catchup ${fromBlock}..${confirmedHead} depth=${confirmationDepth} (chunked by ${chunkSize})`);

  let cursor = fromBlock;
  while (cursor <= confirmedHead) {
    const chunkEnd = Math.min(cursor + chunkSize - 1, confirmedHead);
    const logs = await queryEventLogs(dex, cursor, chunkEnd);
    for (const log of logs) {
      await storeConfirmedLog(db, log, options);
      await replay(log);
    }

    const block = await dex.runner!.provider!.getBlock(chunkEnd);
    if (block?.hash) {
      await db.insert(indexedBlocks).values({
        chainId: options.chainId,
        dexAddress: options.dexAddress,
        blockNumber: BigInt(chunkEnd),
        blockHash: block.hash,
        confirmationStatus: "CONFIRMED",
      }).onConflictDoUpdate({
        target: [indexedBlocks.chainId, indexedBlocks.dexAddress, indexedBlocks.blockNumber],
        set: { blockHash: block.hash, confirmationStatus: "CONFIRMED" },
      });
      if (options.checkpointEveryChunk ?? true) {
        await createRelayerCheckpoint(db, {
          chainId: options.chainId,
          dexAddress: options.dexAddress,
          confirmedBlock: BigInt(chunkEnd),
          confirmedBlockHash: block.hash,
        });
      }
    }

    await db.insert(eventCursor).values({ component: "matcher", lastBlock: BigInt(chunkEnd) })
      .onConflictDoUpdate({ target: eventCursor.component, set: { lastBlock: BigInt(chunkEnd) } });
    cursor = chunkEnd + 1;
  }
  console.log(`confirmed catchup complete at ${confirmedHead}`);
}

export function startCatchupPoller(
  dex: Contract,
  db: Db,
  fromDefault: number,
  replay: (ev: any) => Promise<void>,
  options: CatchupOptions & { intervalSec?: number },
) {
  const intervalSec = options.intervalSec ?? 30;
  if (intervalSec === 0) return;

  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await catchup(dex, db, fromDefault, replay, options);
    } catch (e) {
      console.error("confirmed catchup poll failed:", errorMessage(e));
    } finally {
      running = false;
    }
  }, intervalSec * 1000);
}

async function queryEventLogs(dex: Contract, fromBlock: number, toBlock: number) {
  const allLogs: any[] = [];
  for (const name of EVENT_NAMES) {
    const filter = dex.filters[name]!();
    const logs = await queryFilterWithRetry(dex, filter, name, fromBlock, toBlock);
    allLogs.push(...logs);
  }
  return allLogs.sort(compareLogs);
}

async function storeConfirmedLog(db: Db, log: any, options: Pick<CatchupOptions, "chainId" | "dexAddress">) {
  const eventName = eventNameOf(log);
  if (!eventName || !log.blockNumber || !log.transactionHash) return;
  await db.insert(indexedChainLogs).values({
    chainId: options.chainId,
    dexAddress: options.dexAddress,
    eventName,
    blockNumber: BigInt(log.blockNumber),
    blockHash: String(log.blockHash),
    transactionHash: String(log.transactionHash),
    transactionIndex: Number(log.transactionIndex ?? 0),
    logIndex: Number(log.logIndex ?? log.index ?? 0),
    confirmationStatus: "CONFIRMED",
    payload: logPayload(log),
    confirmedAt: new Date(),
  }).onConflictDoNothing();
}

async function rollbackIfNeeded(dex: Contract, db: Db, options: Pick<CatchupOptions, "chainId" | "dexAddress">) {
  const latest = await db.select()
    .from(indexedBlocks)
    .where(and(
      eq(indexedBlocks.chainId, options.chainId),
      eq(indexedBlocks.dexAddress, options.dexAddress),
    ))
    .orderBy(desc(indexedBlocks.blockNumber))
    .limit(1)
    .then((rows) => rows[0]);
  if (!latest) return;

  const chainBlock = await dex.runner!.provider!.getBlock(Number(latest.blockNumber));
  if (!chainBlock?.hash || chainBlock.hash === latest.blockHash) return;

  const candidates = await db.select()
    .from(indexedBlocks)
    .where(and(
      eq(indexedBlocks.chainId, options.chainId),
      eq(indexedBlocks.dexAddress, options.dexAddress),
    ))
    .orderBy(desc(indexedBlocks.blockNumber))
    .limit(128);
  let commonBlock = 0n;
  for (const candidate of candidates) {
    const block = await dex.runner!.provider!.getBlock(Number(candidate.blockNumber));
    if (block?.hash && block.hash === candidate.blockHash) {
      commonBlock = candidate.blockNumber;
      break;
    }
  }

  console.warn("confirmed index reorg detected", {
    latestIndexedBlock: latest.blockNumber.toString(),
    commonBlock: commonBlock.toString(),
  });
  await rollbackProjectionsAfter(db, options, commonBlock);
  await db.update(eventCursor)
    .set({ lastBlock: commonBlock })
    .where(eq(eventCursor.component, "matcher"));
}

async function rollbackProjectionsAfter(
  db: Db,
  options: Pick<CatchupOptions, "chainId" | "dexAddress">,
  commonBlock: bigint,
) {
  const reorgedLogs = await db.select()
    .from(indexedChainLogs)
    .where(and(
      eq(indexedChainLogs.chainId, options.chainId),
      eq(indexedChainLogs.dexAddress, options.dexAddress),
      gt(indexedChainLogs.blockNumber, commonBlock),
    ));
  const txHashes = Array.from(new Set(reorgedLogs.map((row) => row.transactionHash)));
  if (txHashes.length > 0) {
    await db.delete(orders).where(and(
      eq(orders.chainId, options.chainId),
      eq(orders.dexAddress, options.dexAddress),
      inArray(orders.submitTxHash, txHashes),
    ));
    await db.delete(batches).where(and(
      eq(batches.chainId, options.chainId),
      eq(batches.dexAddress, options.dexAddress),
      inArray(batches.closeTxHash, txHashes),
    ));
    await db.delete(matches).where(and(
      eq(matches.chainId, options.chainId),
      eq(matches.dexAddress, options.dexAddress),
      inArray(matches.publishTxHash, txHashes),
    ));
    await db.update(matches)
      .set({ status: "PENDING", settledAt: null, settleTxHash: null })
      .where(and(
        eq(matches.chainId, options.chainId),
        eq(matches.dexAddress, options.dexAddress),
        inArray(matches.settleTxHash, txHashes),
      ));
  }
  const orderIds = reorgedLogs
    .filter((row) => row.eventName === "OrderSubmitted" || row.eventName === "OrderSubmittedPrivate")
    .map((row) => parsePayloadBigInt(row.payload, "orderId"))
    .filter((value): value is bigint => value !== null);
  for (const orderId of orderIds) {
    await db.delete(orderCommitments).where(and(
      eq(orderCommitments.chainId, options.chainId),
      eq(orderCommitments.dexAddress, options.dexAddress),
      eq(orderCommitments.orderId, orderId),
    ));
  }
  await db.update(indexedChainLogs)
    .set({ confirmationStatus: "REORGED" })
    .where(and(
      eq(indexedChainLogs.chainId, options.chainId),
      eq(indexedChainLogs.dexAddress, options.dexAddress),
      gt(indexedChainLogs.blockNumber, commonBlock),
    ));
  await db.delete(indexedBlocks)
    .where(and(
      eq(indexedBlocks.chainId, options.chainId),
      eq(indexedBlocks.dexAddress, options.dexAddress),
      gt(indexedBlocks.blockNumber, commonBlock),
    ));
}

async function queryFilterWithRetry(dex: Contract, filter: any, name: string, fromBlock: number, toBlock: number) {
  for (let attempt = 1; attempt <= MAX_QUERY_ATTEMPTS; attempt++) {
    try {
      return await dex.queryFilter(filter, fromBlock, toBlock);
    } catch (e) {
      if (attempt === MAX_QUERY_ATTEMPTS) {
        console.error(`catchup ${name} ${fromBlock}..${toBlock} failed permanently:`, errorMessage(e));
        throw e;
      }
      const delayMs = Math.min(1_000 * 2 ** (attempt - 1), 12_000);
      console.warn(`catchup ${name} ${fromBlock}..${toBlock} retry ${attempt}/${MAX_QUERY_ATTEMPTS}:`, errorMessage(e));
      await sleep(delayMs);
    }
  }
  return [];
}

function compareLogs(a: any, b: any) {
  return Number(a.blockNumber ?? 0) - Number(b.blockNumber ?? 0)
    || Number(a.transactionIndex ?? 0) - Number(b.transactionIndex ?? 0)
    || Number(a.logIndex ?? a.index ?? 0) - Number(b.logIndex ?? b.index ?? 0);
}

function eventNameOf(log: any): string | null {
  return log?.fragment?.name ?? log?.eventName ?? log?.name ?? null;
}

function logPayload(log: any) {
  const args = log.args ?? {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(args)) {
    if (/^\d+$/.test(key)) continue;
    out[key] = jsonValue(args[key]);
  }
  return out;
}

function jsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]));
  }
  return value;
}

function parsePayloadBigInt(payload: unknown, key: string): bigint | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
