import { runAuction } from "../../../shared/auction/auction.js";
import type { DecryptedOrder } from "../../../shared/auction/types.js";
import { unseal128 } from "../fhe/unseal.js";
import type { Contract } from "ethers";
import type { Db } from "../db/client.js";
import { orders as ordersTable } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { normalizeDexAddress, type DeploymentScope } from "../orders/lifecycle.js";

export type BatchAuctionResult = ReturnType<typeof runAuction> & {
  inputOrders: DecryptedOrder[];
};

export async function matchBatch(
  _dex: Contract,
  dexAddr: string,
  db: Db,
  batchId: bigint,
  pairId: number,
  decimals: { base: number; quote: number },
  options: { chainId?: number } = {},
): Promise<BatchAuctionResult> {
  const scope: DeploymentScope = {
    chainId: options.chainId ?? 421614,
    dexAddress: normalizeDexAddress(dexAddr),
  };
  const rows = await db.select().from(ordersTable).where(and(
    eq(ordersTable.chainId, scope.chainId),
    eq(ordersTable.dexAddress, scope.dexAddress),
    eq(ordersTable.batchId, batchId),
    eq(ordersTable.pairId, pairId),
    eq(ordersTable.status, "ACTIVE"),
  ));
  const decrypted: DecryptedOrder[] = [];
  for (const r of rows) {
    const handles = {
      baseDeposit: handleValue(r.remainingBaseDeposit, r.encBaseDepositHandle),
      quoteDeposit: handleValue(r.remainingQuoteDeposit, r.encQuoteDepositHandle),
      baseRequest: handleValue(r.remainingBaseRequest, r.encBaseRequestHandle),
      quoteRequest: handleValue(r.remainingQuoteRequest, r.encQuoteRequestHandle),
    };
    if (!handles.baseDeposit || !handles.quoteDeposit || !handles.baseRequest || !handles.quoteRequest) continue;

    const [baseDeposit, quoteDeposit, baseRequest, quoteRequest] = await Promise.all([
      unseal128(dexAddr, BigInt(handles.baseDeposit)),
      unseal128(dexAddr, BigInt(handles.quoteDeposit)),
      unseal128(dexAddr, BigInt(handles.baseRequest)),
      unseal128(dexAddr, BigInt(handles.quoteRequest)),
    ]);

    const order = classifyPrivateSideOrder({
      id: r.id,
      baseDeposit,
      quoteDeposit,
      baseRequest,
      quoteRequest,
      cashDecimals: decimals.base, assetDecimals: decimals.quote,
    });
    if (order) decrypted.push(order);
    if (order && r.side !== order.side) {
      await db.update(ordersTable)
        .set({ side: order.side })
        .where(and(
          eq(ordersTable.chainId, scope.chainId),
          eq(ordersTable.dexAddress, scope.dexAddress),
          eq(ordersTable.id, r.id),
        ));
    }
  }
  return {
    ...runAuction(decrypted),
    inputOrders: decrypted,
  };
}

function handleValue(primary?: string | null, fallback?: string | null) {
  return primary ?? fallback ?? undefined;
}

function classifyPrivateSideOrder(args: {
  id: bigint;
  baseDeposit: bigint;
  quoteDeposit: bigint;
  baseRequest: bigint;
  quoteRequest: bigint;
  cashDecimals: number;
  assetDecimals: number;
}): DecryptedOrder | undefined {
  const isBuy =
    args.baseDeposit > 0n &&
    args.quoteRequest > 0n &&
    args.quoteDeposit === 0n &&
    args.baseRequest === 0n;
  if (isBuy) {
    return {
      id: args.id,
      side: "BUY",
      remainingDeposit: args.baseDeposit,
      remainingRequest: args.quoteRequest,
      cashDecimals: args.cashDecimals,
      assetDecimals: args.assetDecimals,
    };
  }

  const isSell =
    args.quoteDeposit > 0n &&
    args.baseRequest > 0n &&
    args.baseDeposit === 0n &&
    args.quoteRequest === 0n;
  if (isSell) {
    return {
      id: args.id,
      side: "SELL",
      remainingDeposit: args.quoteDeposit,
      remainingRequest: args.baseRequest,
      cashDecimals: args.cashDecimals,
      assetDecimals: args.assetDecimals,
    };
  }
  return undefined;
}
