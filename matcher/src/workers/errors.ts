import type { Db } from "../db/client.js";
import { errors as errorsTable } from "../db/schema.js";
import { redactErrorMessage, sanitizeWorkerErrorPayload } from "../privacy/redaction.js";

export async function recordWorkerError(db: Db, component: string, payload: Record<string, unknown>) {
  const sanitized = sanitizeWorkerErrorPayload(payload) ?? {
    error: redactErrorMessage(String(payload.error ?? "worker error")),
  };
  try {
    await db.insert(errorsTable).values({ component, payload: sanitized });
  } catch (error) {
    console.error("failed to record worker error", errorMessage(error));
  }
}

export function workerErrorPayload(error: unknown, extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    error: errorMessage(error),
  };
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
