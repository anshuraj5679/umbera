import { S3Client } from "@aws-sdk/client-s3";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { matches as matchesTable } from "../db/schema.js";
import type { DeploymentScope } from "../orders/lifecycle.js";
import { fetchAuditTranscript } from "./verifier.js";

export type AuditObjectPrivacyIssue = {
  code: "LEGACY_AUDIT_SCHEMA" | "AUDIT_PRIVATE_FIELDS" | "AUDIT_SCAN_FAILED";
  matchId: string;
  batchId: string;
  schema: string | null;
  forbiddenFields?: string[];
};

export type AuditObjectPrivacyScan = {
  checked: number;
  legacySchemaCount: number;
  forbiddenFieldCount: number;
  failedCount: number;
  issues: AuditObjectPrivacyIssue[];
};

const RECEIPT_V2_SCHEMA = "obsidian.match.proof-receipt.v2";
const defaultS3Client = new S3Client({ region: process.env.S3_REGION ?? "ap-south-1" });
const FORBIDDEN_AUDIT_FIELD_NAMES = new Set([
  "auction",
  "inputOrders",
  "privateProofSalt",
  "side",
  "remainingDeposit",
  "remainingRequest",
  "cashDecimals",
  "assetDecimals",
]);

export async function scanAuditObjectPrivacy(db: Db, input: {
  scope: DeploymentScope;
  bucket: string;
  limit?: number;
  s3Client?: S3Client;
}): Promise<AuditObjectPrivacyScan> {
  const rows = await db.select()
    .from(matchesTable)
    .where(and(
      eq(matchesTable.chainId, input.scope.chainId),
      eq(matchesTable.dexAddress, input.scope.dexAddress),
      isNotNull(matchesTable.auditS3Key),
    ))
    .orderBy(desc(matchesTable.publishedAt), desc(matchesTable.id))
    .limit(input.limit ?? 5);

  const issues: AuditObjectPrivacyIssue[] = [];
  let checked = 0;
  let legacySchemaCount = 0;
  let forbiddenFieldCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    if (!row.auditS3Key) continue;
    checked++;
    try {
      const transcript = await fetchAuditTranscript(input.s3Client ?? defaultS3Client, input.bucket, row.auditS3Key);
      const schema = typeof transcript.schema === "string" ? transcript.schema : null;
      const forbiddenFields = forbiddenAuditFields(transcript);
      if (schema !== RECEIPT_V2_SCHEMA) {
        legacySchemaCount++;
        issues.push({
          code: "LEGACY_AUDIT_SCHEMA",
          matchId: row.id.toString(),
          batchId: row.batchId.toString(),
          schema,
        });
      }
      if (schema === RECEIPT_V2_SCHEMA && forbiddenFields.length > 0) {
        forbiddenFieldCount++;
        issues.push({
          code: "AUDIT_PRIVATE_FIELDS",
          matchId: row.id.toString(),
          batchId: row.batchId.toString(),
          schema,
          forbiddenFields,
        });
      }
    } catch {
      failedCount++;
      issues.push({
        code: "AUDIT_SCAN_FAILED",
        matchId: row.id.toString(),
        batchId: row.batchId.toString(),
        schema: null,
      });
    }
  }

  return {
    checked,
    legacySchemaCount,
    forbiddenFieldCount,
    failedCount,
    issues,
  };
}

export function forbiddenAuditFields(value: unknown): string[] {
  const found = new Set<string>();
  walkAuditObject(value, found);
  return [...found].sort();
}

function walkAuditObject(value: unknown, found: Set<string>) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkAuditObject(item, found);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_AUDIT_FIELD_NAMES.has(key)) {
      found.add(key);
    }
    walkAuditObject(child, found);
  }
}
