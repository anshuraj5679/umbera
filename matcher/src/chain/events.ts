import type { Contract } from "ethers";
import type { Db } from "../db/client.js";
import { batches, matches, orders } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { markOrderCommitmentsConsumed, upsertOrderCommitment } from "../relayer/commitments.js";
import { markOrdersMatched, markOrdersSettled, normalizeDexAddress, type DeploymentScope } from "../orders/lifecycle.js";

export type EventHandler = (ev: any) => Promise<void>;

export function subscribe(dex: Contract, handlers: Record<string, EventHandler>) {
  for (const [name, fn] of Object.entries(handlers)) {
    dex.on(name, (...args) => {
      const ev = args[args.length - 1];
      fn(ev).catch((e) => console.error(`handler ${name} failed`, e));
    });
  }
}

function eventName(ev: any): string | undefined {
  return ev?.fragment?.name ?? ev?.eventName ?? ev?.name;
}

function orderStatusLabel(value: number): string {
  return ["ACTIVE", "MATCHED", "SETTLED", "CANCELLED"][value] ?? "UNKNOWN";
}

function matchStatusLabel(value: number): string {
  return ["PENDING", "DISPUTED", "SETTLED", "VOIDED"][value] ?? "UNKNOWN";
}

export type IndexContext = {
  chainId: number;
  dexAddress: string;
};

export async function indexDexEvent(dex: Contract, db: Db, ev: any, ctx?: IndexContext) {
  const name = eventName(ev);
  const args = ev.args ?? {};
  if (!name) return;
  const scope = eventScope(dex, ctx);

  if (name === "OrderSubmitted" || name === "OrderSubmittedPrivate") {
    const orderId = BigInt(args.orderId);
    const [info, legs, accountCommitmentRaw] = await Promise.all([
      (dex as any).getOrderInfo(orderId),
      (dex as any).getOrderLegs(orderId),
      readOrderAccountCommitment(dex, orderId),
    ]);
    const eventAccountCommitment = typeof args.accountCommitment === "string" ? args.accountCommitment : null;
    const accountCommitment = normalizeAccountCommitment(eventAccountCommitment ?? accountCommitmentRaw);
    const baseDeposit = legs.baseDeposit ?? legs[0];
    const quoteDeposit = legs.quoteDeposit ?? legs[1];
    const baseRequest = legs.baseRequest ?? legs[2];
    const quoteRequest = legs.quoteRequest ?? legs[3];
    const status = orderStatusLabel(Number(info.status ?? info[5]));
    const createdAt = Number(info.createdAt ?? info[3]);
    const expiry = BigInt(info.expiry ?? info[4]);

    await db.insert(orders).values({
      chainId: scope.chainId,
      dexAddress: scope.dexAddress,
      id: orderId,
      pairId: Number(info.pairId ?? info[1]),
      batchId: BigInt(info.batchId ?? info[2]),
      trader: String(info.trader ?? info[0]),
      side: "PRIVATE",
      status,
      encBaseDepositHandle: baseDeposit.toString(),
      encQuoteDepositHandle: quoteDeposit.toString(),
      encBaseRequestHandle: baseRequest.toString(),
      encQuoteRequestHandle: quoteRequest.toString(),
      remainingBaseDeposit: baseDeposit.toString(),
      remainingQuoteDeposit: quoteDeposit.toString(),
      remainingBaseRequest: baseRequest.toString(),
      remainingQuoteRequest: quoteRequest.toString(),
      createdAt: new Date(createdAt * 1000),
      expiry,
      submitTxHash: ev.transactionHash,
      accountCommitment,
    }).onConflictDoUpdate({
      target: [orders.chainId, orders.dexAddress, orders.id],
      set: {
        pairId: Number(info.pairId ?? info[1]),
        batchId: BigInt(info.batchId ?? info[2]),
        trader: String(info.trader ?? info[0]),
        side: "PRIVATE",
        status,
        encBaseDepositHandle: baseDeposit.toString(),
        encQuoteDepositHandle: quoteDeposit.toString(),
        encBaseRequestHandle: baseRequest.toString(),
        encQuoteRequestHandle: quoteRequest.toString(),
        remainingBaseDeposit: baseDeposit.toString(),
        remainingQuoteDeposit: quoteDeposit.toString(),
        remainingBaseRequest: baseRequest.toString(),
        remainingQuoteRequest: quoteRequest.toString(),
        createdAt: new Date(createdAt * 1000),
        expiry,
        submitTxHash: ev.transactionHash,
        accountCommitment,
      },
    });
    if (ctx) {
      await upsertOrderCommitment(db, {
        chainId: scope.chainId,
        dexAddress: scope.dexAddress,
        orderId,
        trader: String(info.trader ?? info[0]),
        pairId: Number(info.pairId ?? info[1]),
        batchId: BigInt(info.batchId ?? info[2]),
        expiry,
        accountCommitment,
        encBaseDepositHandle: baseDeposit.toString(),
        encQuoteDepositHandle: quoteDeposit.toString(),
        encBaseRequestHandle: baseRequest.toString(),
        encQuoteRequestHandle: quoteRequest.toString(),
        submitTxHash: ev.transactionHash,
        logIndex: Number(ev.logIndex ?? ev.index ?? 0),
      });
    }
    return;
  }

  if (name === "BatchClosed") {
    const batchId = BigInt(args.batchId);
    const timestamp = Number(args.timestamp ?? 0);
    await db.insert(batches).values({
      chainId: scope.chainId,
      dexAddress: scope.dexAddress,
      id: batchId,
      openedAt: new Date(0),
      closedAt: timestamp ? new Date(timestamp * 1000) : new Date(),
      status: "CLOSED",
      closeTxHash: ev.transactionHash,
    }).onConflictDoUpdate({
      target: [batches.chainId, batches.dexAddress, batches.id],
      set: {
        closedAt: timestamp ? new Date(timestamp * 1000) : new Date(),
        status: "CLOSED",
        closeTxHash: ev.transactionHash,
      },
    });
    return;
  }

  if (name === "MatchPublished") {
    const matchId = BigInt(args.matchId);
    const info = await (dex as any).getMatchInfo(matchId);
    const orderAId = BigInt(info.orderAId ?? info[1]);
    const orderBId = BigInt(info.orderBId ?? info[2]);
    await db.insert(matches).values({
      chainId: scope.chainId,
      dexAddress: scope.dexAddress,
      id: matchId,
      batchId: BigInt(args.batchId),
      pairId: Number(info.pairId ?? info[0]),
      buyOrderId: orderAId,
      sellOrderId: orderBId,
      status: matchStatusLabel(Number(info.status ?? info[4])),
      publishedAt: new Date(Number(info.publishedAt ?? info[3]) * 1000),
      publishTxHash: ev.transactionHash,
    }).onConflictDoUpdate({
      target: [matches.chainId, matches.dexAddress, matches.id],
      set: {
        batchId: BigInt(args.batchId),
        pairId: Number(info.pairId ?? info[0]),
        buyOrderId: orderAId,
        sellOrderId: orderBId,
        status: matchStatusLabel(Number(info.status ?? info[4])),
        publishedAt: new Date(Number(info.publishedAt ?? info[3]) * 1000),
        settledAt: null,
        auditS3Key: null,
        publishTxHash: ev.transactionHash,
        settleTxHash: null,
      },
    });
    await markOrdersMatched(db, [orderAId, orderBId], scope);
    return;
  }

  if (name === "MatchDisputed") {
    await db.update(matches)
      .set({ status: "DISPUTED" })
      .where(scopedIdWhere(matches, scope, BigInt(args.matchId)));
    return;
  }

  if (name === "MatchSettled") {
    const matchId = BigInt(args.matchId);
    const info = await (dex as any).getMatchInfo(matchId);
    await db.update(matches)
      .set({ status: "SETTLED", settledAt: new Date(), settleTxHash: ev.transactionHash })
      .where(scopedIdWhere(matches, scope, matchId));
    const orderAId = BigInt((info.orderAId ?? info[1]).toString());
    const orderBId = BigInt((info.orderBId ?? info[2]).toString());
    await markOrdersSettled(db, [orderAId, orderBId], scope);
    if (ctx) {
      await markOrderCommitmentsConsumed(db, {
        matchId,
        chainId: scope.chainId,
        dexAddress: scope.dexAddress,
        orderIds: [orderAId, orderBId],
      });
    }
  }
}

function eventScope(dex: Contract, ctx?: IndexContext): DeploymentScope {
  return {
    chainId: ctx?.chainId ?? 421614,
    dexAddress: normalizeDexAddress(ctx?.dexAddress ?? String((dex as any).target ?? (dex as any).address ?? "unknown")),
  };
}

function scopedIdWhere(table: { chainId: any; dexAddress: any; id: any }, scope: DeploymentScope, id: bigint) {
  return and(
    eq(table.chainId, scope.chainId),
    eq(table.dexAddress, scope.dexAddress),
    eq(table.id, id),
  );
}

async function readOrderAccountCommitment(dex: Contract, orderId: bigint): Promise<string | null> {
  try {
    return String(await (dex as any).getOrderAccountCommitment(orderId));
  } catch {
    return null;
  }
}

function normalizeAccountCommitment(value: string | null): string | null {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) return null;
  const normalized = value.toLowerCase();
  return /^0x0{64}$/.test(normalized) ? null : normalized;
}
