import { ethers } from "ethers";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { consumedNullifiers, orderCommitments, relayerStateCheckpoints } from "../db/schema.js";
import { orderCommitmentAndNullifier } from "../../../shared/commitments/index.js";

export type IndexedOrderForCommitment = {
  chainId: number;
  dexAddress: string;
  orderId: bigint;
  trader: string;
  pairId: number;
  batchId: bigint;
  expiry: bigint;
  encBaseDepositHandle: string;
  encQuoteDepositHandle: string;
  encBaseRequestHandle: string;
  encQuoteRequestHandle: string;
  submitTxHash: string | null;
  logIndex?: number;
  accountId?: string | null;
  accountCommitment?: string | null;
};

export async function upsertOrderCommitment(db: Db, input: IndexedOrderForCommitment) {
  const salt = orderSalt(input);
  const { commitment, nullifier } = orderCommitmentAndNullifier({
    chainId: input.chainId,
    dexAddress: input.dexAddress as `0x${string}`,
    trader: input.trader as `0x${string}`,
    accountCommitment: input.accountCommitment as `0x${string}` | null | undefined,
    pairId: input.pairId,
    batchId: input.batchId,
    orderId: input.orderId,
    encBaseDepositHandle: input.encBaseDepositHandle,
    encQuoteDepositHandle: input.encQuoteDepositHandle,
    encBaseRequestHandle: input.encBaseRequestHandle,
    encQuoteRequestHandle: input.encQuoteRequestHandle,
    expiry: input.expiry,
    salt,
  });

  await db.insert(orderCommitments).values({
    commitment,
    chainId: input.chainId,
    dexAddress: ethers.getAddress(input.dexAddress),
    orderId: input.orderId,
    accountId: input.accountId ?? null,
    accountCommitment: input.accountCommitment ?? null,
    trader: ethers.getAddress(input.trader),
    pairId: input.pairId,
    batchId: input.batchId,
    salt,
    nullifier,
    status: "ACTIVE",
  }).onConflictDoUpdate({
    target: [
      orderCommitments.chainId,
      orderCommitments.dexAddress,
      orderCommitments.orderId,
    ],
    set: {
      commitment,
      status: "ACTIVE",
      salt,
      nullifier,
      accountId: input.accountId ?? null,
      accountCommitment: input.accountCommitment ?? null,
    },
  });

  return { commitment, nullifier, salt };
}

export async function markOrderCommitmentsConsumed(db: Db, input: {
  matchId: bigint;
  chainId: number;
  dexAddress: string;
  orderIds: bigint[];
}) {
  for (const orderId of input.orderIds) {
    const row = await db.select()
      .from(orderCommitments)
      .where(and(
        eq(orderCommitments.chainId, input.chainId),
        eq(orderCommitments.dexAddress, ethers.getAddress(input.dexAddress)),
        eq(orderCommitments.orderId, orderId),
      ))
      .limit(1)
      .then((rows) => rows[0]);
    if (!row) continue;
    await db.insert(consumedNullifiers).values({
      nullifier: row.nullifier,
      commitment: row.commitment,
      consumedByMatchId: input.matchId,
    }).onConflictDoNothing();
    await db.update(orderCommitments)
      .set({ status: "CONSUMED" })
      .where(eq(orderCommitments.commitment, row.commitment));
  }
}

export async function createRelayerCheckpoint(db: Db, input: {
  chainId: number;
  dexAddress: string;
  confirmedBlock: bigint;
  confirmedBlockHash: string;
}) {
  const [orderCountRow, consumedCountRow] = await Promise.all([
    db.select({ value: sql<number>`count(*)::int` }).from(orderCommitments).then((rows) => rows[0]),
    db.select({ value: sql<number>`count(*)::int` }).from(consumedNullifiers).then((rows) => rows[0]),
  ]);
  const orderCommitmentCount = orderCountRow?.value ?? 0;
  const consumedNullifierCount = consumedCountRow?.value ?? 0;
  const stateRoot = ethers.solidityPackedKeccak256(
    ["string", "uint256", "address", "uint256", "bytes32", "uint256", "uint256"],
    [
      "obsidian.relayer.state.v1",
      input.chainId,
      ethers.getAddress(input.dexAddress),
      input.confirmedBlock,
      input.confirmedBlockHash,
      BigInt(orderCommitmentCount),
      BigInt(consumedNullifierCount),
    ],
  );
  await db.insert(relayerStateCheckpoints).values({
    chainId: input.chainId,
    dexAddress: ethers.getAddress(input.dexAddress),
    confirmedBlock: input.confirmedBlock,
    confirmedBlockHash: input.confirmedBlockHash,
    stateRoot,
    orderCommitmentCount,
    consumedNullifierCount,
  });
  return { stateRoot, orderCommitmentCount, consumedNullifierCount };
}

export async function latestRelayerCheckpoint(db: Db) {
  return db.select()
    .from(relayerStateCheckpoints)
    .orderBy(desc(relayerStateCheckpoints.createdAt), desc(relayerStateCheckpoints.id))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

function orderSalt(input: IndexedOrderForCommitment) {
  return ethers.solidityPackedKeccak256(
    ["string", "uint256", "address", "uint256", "bytes32", "uint256"],
    [
      "obsidian.relayer.order-salt.v1",
      input.chainId,
      ethers.getAddress(input.dexAddress),
      input.orderId,
      normalizeTxHash(input.submitTxHash),
      BigInt(input.logIndex ?? 0),
    ],
  ) as `0x${string}`;
}

function normalizeTxHash(value: string | null) {
  if (value && /^0x[0-9a-fA-F]{64}$/.test(value)) return value;
  return ethers.ZeroHash;
}
