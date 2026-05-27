import { createHash } from "node:crypto";
import { desc, eq, isNotNull } from "drizzle-orm";
import { getAddress, isAddress, type Hex } from "viem";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { relayerAccounts } from "../db/schema.js";
import {
  accountCommitmentAndNullifier,
  normalizeBytes32,
  normalizeHexBytes,
  ownerCommitment,
} from "../../../shared/commitments/index.js";

const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const hexBytesSchema = z.string().regex(/^0x([0-9a-fA-F]{2})+$/);
const addressSchema = z.string().refine((value) => isAddress(value), "expected EVM address");

export const createSessionAccountSchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  dexAddress: addressSchema.optional(),
  sessionPublicKey: hexBytesSchema,
  ownerCommitment: bytes32Schema.optional(),
  ownerAddress: addressSchema.optional(),
  ownerSalt: bytes32Schema.optional(),
  accountSalt: bytes32Schema.optional(),
  label: z.string().trim().min(1).max(120).optional(),
  createdTxHash: bytes32Schema.optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.ownerCommitment && (!value.ownerAddress || !value.ownerSalt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ownerCommitment or ownerAddress+ownerSalt is required",
      path: ["ownerCommitment"],
    });
  }
});

export type CreateSessionAccountRequest = z.infer<typeof createSessionAccountSchema>;
export type RelayerAccountRow = typeof relayerAccounts.$inferSelect;

export async function upsertSessionAccount(
  db: Db,
  request: CreateSessionAccountRequest,
  defaults: { chainId: number; dexAddress: string },
) {
  const chainId = request.chainId ?? defaults.chainId;
  const dexAddress = getAddress((request.dexAddress ?? defaults.dexAddress) as `0x${string}`);
  const sessionPublicKey = normalizeSessionKey(request.sessionPublicKey);
  const owner = request.ownerCommitment
    ? normalizeBytes32(request.ownerCommitment as Hex)
    : ownerCommitment({
      chainId,
      dexAddress,
      ownerAddress: request.ownerAddress as `0x${string}`,
      salt: request.ownerSalt as Hex,
    });
  const account = accountCommitmentAndNullifier({
    chainId,
    dexAddress,
    ownerCommitment: owner,
    sessionPublicKey,
    salt: request.accountSalt as Hex | undefined,
  });
  const id = sessionAccountId(account.commitment);
  const now = new Date();
  const row = {
    id,
    address: sessionPublicKey,
    chainId,
    dexAddress,
    ownerCommitment: owner,
    sessionPublicKey,
    accountCommitment: account.commitment,
    accountNullifier: account.nullifier,
    labelHash: request.label ? hashLabel(request.label) : null,
    createdTxHash: request.createdTxHash?.toLowerCase() ?? null,
    lastSeenAt: now,
    status: "ACTIVE",
    updatedAt: now,
  };

  await db.insert(relayerAccounts).values(row).onConflictDoUpdate({
    target: relayerAccounts.accountCommitment,
    set: {
      address: row.address,
      chainId: row.chainId,
      dexAddress: row.dexAddress,
      ownerCommitment: row.ownerCommitment,
      sessionPublicKey: row.sessionPublicKey,
      accountNullifier: row.accountNullifier,
      labelHash: row.labelHash,
      createdTxHash: row.createdTxHash,
      lastSeenAt: row.lastSeenAt,
      status: "ACTIVE",
      updatedAt: row.updatedAt,
    },
  });

  const saved = await sessionAccountByCommitment(db, account.commitment);
  return saved ?? {
    ...row,
    createdAt: now,
  } satisfies RelayerAccountRow;
}

export async function sessionAccountByCommitment(db: Db, accountCommitment: string) {
  const commitment = normalizeBytes32(accountCommitment as Hex);
  return db.select()
    .from(relayerAccounts)
    .where(eq(relayerAccounts.accountCommitment, commitment))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

export async function recentSessionAccounts(db: Db, limit: number) {
  return db.select()
    .from(relayerAccounts)
    .where(isNotNull(relayerAccounts.accountCommitment))
    .orderBy(desc(relayerAccounts.updatedAt), desc(relayerAccounts.createdAt))
    .limit(limit);
}

export function publicSessionAccountRow(row: RelayerAccountRow) {
  return {
    id: row.id,
    chainId: row.chainId,
    dexAddress: row.dexAddress,
    accountCommitment: row.accountCommitment,
    labelHash: row.labelHash,
    status: row.status,
    createdTxHash: row.createdTxHash,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeSessionKey(value: string) {
  if (isAddress(value)) return getAddress(value as `0x${string}`).toLowerCase() as Hex;
  return normalizeHexBytes(value as Hex);
}

function sessionAccountId(commitment: Hex) {
  return `acct_${commitment.slice(2, 18)}`;
}

function hashLabel(value: string) {
  return `sha256:${createHash("sha256").update(value.trim()).digest("hex")}`;
}
