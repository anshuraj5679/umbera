import { createHash, createHmac } from "node:crypto";
import type { AgentOrderResult } from "../agent/orders.js";

const SAFE_ERROR_KEYS = new Set(["code", "error", "message", "reason"]);

export function hashPrivateValue(value: string, secret?: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  const digest = secret
    ? createHmac("sha256", secret).update(normalized).digest("hex")
    : createHash("sha256").update(normalized).digest("hex");
  return `sha256:${digest}`;
}

export function agentOrderIdempotencyKey(clientOrderId: string, secret?: string) {
  const hashed = hashPrivateValue(clientOrderId, secret);
  return hashed ? `agent:${hashed}` : undefined;
}

export function sanitizeAgentOrderTaskPayload(input: unknown, secret?: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { requestShape: "invalid" };
  }
  const body = input as Record<string, unknown>;
  return {
    requestShape: "agent_order",
    pairId: safeInteger(body.pairId),
    expiryHours: safeInteger(body.expiryHours),
    hasClientOrderId: typeof body.clientOrderId === "string" && body.clientOrderId.trim().length > 0,
    clientOrderIdHash: typeof body.clientOrderId === "string" ? hashPrivateValue(body.clientOrderId, secret) : null,
    hasAgent: typeof body.agent === "string" && body.agent.trim().length > 0,
    agentHash: typeof body.agent === "string" ? hashPrivateValue(body.agent, secret) : null,
    sessionAccountCommitment: typeof body.sessionAccountCommitment === "string" && /^0x[0-9a-fA-F]{64}$/.test(body.sessionAccountCommitment)
      ? body.sessionAccountCommitment.toLowerCase()
      : null,
  };
}

export function publicAgentOrderResult(result: AgentOrderResult) {
  return {
    ok: result.ok,
    txHash: result.txHash,
    orderId: result.orderId,
    batchId: result.batchId,
    pairId: result.pairId,
    expiry: result.expiry,
    accountCommitment: result.accountCommitment,
  };
}

export function sanitizeWorkerErrorPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const source = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["batchId", "matchId", "orderId", "pairId", "txHash", "code"]) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  const error = source.error;
  if (typeof error === "string") out.error = redactErrorMessage(error);
  return Object.keys(out).length > 0 ? out : null;
}

export function redactErrorMessage(value: string) {
  let redacted = value;
  redacted = redacted.replace(/0x[0-9a-fA-F]{64}/g, "[tx-or-bytes32]");
  redacted = redacted.replace(/0x[0-9a-fA-F]{40}/g, "[address]");
  redacted = redacted.replace(/\b(BUY|SELL)\b/g, "[side]");
  redacted = redacted.replace(/"(side|size|limitPrice|clientOrderId|trader)"\s*:\s*"[^"]*"/gi, "\"$1\":\"[redacted]\"");
  return redacted.slice(0, 240);
}

export function isSafeErrorDetailKey(key: string) {
  return SAFE_ERROR_KEYS.has(key);
}

function safeInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
