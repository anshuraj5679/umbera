import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentAccessTokens } from "../db/schema.js";
import { normalizeDexAddress } from "../orders/lifecycle.js";

const TOKEN_PREFIX = "obsat";
const TOKEN_SCOPE = "agent:order";

export type AgentAccessGrant = {
  token: string;
  tokenHash: string;
  scope: typeof TOKEN_SCOPE;
  chainId: number;
  dexAddress: string;
  issuedAt: Date;
  expiresAt: Date;
  maxUses: number;
};

export class AgentAccessError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentAccessError";
  }
}

export async function issueAgentAccessToken(db: Db, input: {
  secret: string;
  chainId: number;
  dexAddress: string;
  ttlSec: number;
  maxUses: number;
  subjectHash?: string | null;
}): Promise<AgentAccessGrant> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.max(1, input.ttlSec) * 1000);
  const nonce = base64url(randomBytes(32));
  const signature = signNonce(input.secret, nonce);
  const token = `${TOKEN_PREFIX}_${nonce}.${signature}`;
  const tokenHash = hashToken(token);
  const grant = {
    token,
    tokenHash,
    scope: TOKEN_SCOPE,
    chainId: input.chainId,
    dexAddress: normalizeDexAddress(input.dexAddress),
    issuedAt: now,
    expiresAt,
    maxUses: Math.max(1, input.maxUses),
  } satisfies AgentAccessGrant;

  await db.insert(agentAccessTokens).values({
    tokenHash,
    chainId: grant.chainId,
    dexAddress: grant.dexAddress,
    scope: grant.scope,
    subjectHash: input.subjectHash ?? null,
    status: "ACTIVE",
    maxUses: grant.maxUses,
    usedCount: 0,
    issuedAt: now,
    expiresAt,
  });
  return grant;
}

export async function consumeAgentAccessToken(db: Db, input: {
  token: string | null | undefined;
  secret: string;
  chainId: number;
  dexAddress: string;
}) {
  const token = normalizeBearerToken(input.token);
  if (!token) throw new AgentAccessError(401, "agent_access_token_required", "Bearer access token is required.");
  assertTokenSignature(token, input.secret);

  const now = new Date();
  const tokenHash = hashToken(token);
  const scopeDex = normalizeDexAddress(input.dexAddress);
  const rows = await db.select()
    .from(agentAccessTokens)
    .where(and(
      eq(agentAccessTokens.tokenHash, tokenHash),
      eq(agentAccessTokens.chainId, input.chainId),
      eq(agentAccessTokens.dexAddress, scopeDex),
      eq(agentAccessTokens.scope, TOKEN_SCOPE),
      eq(agentAccessTokens.status, "ACTIVE"),
      gt(agentAccessTokens.expiresAt, now),
      lt(agentAccessTokens.usedCount, agentAccessTokens.maxUses),
    ))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AgentAccessError(401, "agent_access_token_invalid", "Access token is invalid, expired, or already used.");

  await db.update(agentAccessTokens)
    .set({
      usedCount: sql`${agentAccessTokens.usedCount} + 1`,
      lastUsedAt: now,
      status: row.usedCount + 1 >= row.maxUses ? "USED" : "ACTIVE",
    })
    .where(and(
      eq(agentAccessTokens.tokenHash, tokenHash),
      lt(agentAccessTokens.usedCount, agentAccessTokens.maxUses),
    ));

  return {
    tokenHash,
    scope: row.scope,
    expiresAt: row.expiresAt,
    remainingUses: Math.max(0, row.maxUses - row.usedCount - 1),
  };
}

export async function sweepExpiredAgentAccessTokens(db: Db, input?: {
  chainId?: number;
  dexAddress?: string;
}) {
  const now = new Date();
  const conditions = [
    eq(agentAccessTokens.status, "ACTIVE"),
    lte(agentAccessTokens.expiresAt, now),
  ];
  if (typeof input?.chainId === "number") {
    conditions.push(eq(agentAccessTokens.chainId, input.chainId));
  }
  if (input?.dexAddress) {
    conditions.push(eq(agentAccessTokens.dexAddress, normalizeDexAddress(input.dexAddress)));
  }
  const result = await db.update(agentAccessTokens)
    .set({ status: "EXPIRED", lastUsedAt: now })
    .where(and(...conditions));
  return Number((result as any)?.rowCount ?? 0);
}

export function publicAgentAccessGrant(grant: AgentAccessGrant) {
  return {
    ok: true,
    accessToken: grant.token,
    tokenType: "Bearer",
    scope: grant.scope,
    chainId: grant.chainId,
    dexAddress: grant.dexAddress,
    expiresAt: grant.expiresAt.toISOString(),
    maxUses: grant.maxUses,
  };
}

export function extractBearerToken(header: string | undefined) {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function hashToken(token: string) {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function normalizeBearerToken(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function assertTokenSignature(token: string, secret: string) {
  const parsed = parseToken(token);
  if (!parsed) throw new AgentAccessError(401, "agent_access_token_malformed", "Access token is malformed.");
  const expected = signNonce(secret, parsed.nonce);
  if (!constantTimeEqual(parsed.signature, expected)) {
    throw new AgentAccessError(401, "agent_access_token_invalid", "Access token signature is invalid.");
  }
}

function parseToken(token: string) {
  const match = /^obsat_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) return null;
  return { nonce: match[1]!, signature: match[2]! };
}

function signNonce(secret: string, nonce: string) {
  return base64url(createHmac("sha256", secret).update(`${TOKEN_PREFIX}:${nonce}`).digest());
}

function base64url(value: Buffer) {
  return value.toString("base64url");
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
