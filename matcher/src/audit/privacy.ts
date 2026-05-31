import { S3Client } from "@aws-sdk/client-s3";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { matches as matchesTable } from "../db/schema.js";
import type { DeploymentScope } from "../orders/lifecycle.js";
import { writeAuditLog } from "./s3.js";
import {
  fetchAuditTranscript,
  verifyAuditTranscriptFromS3,
  type AuditMatchRow,
  type AuditProofReceipt,
} from "./verifier.js";

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

export type AuditObjectPrivacyRepairResult = {
  checked: number;
  rewritten: number;
  skipped: number;
  failed: number;
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

export async function repairLegacyAuditObjects(db: Db, input: {
  scope: DeploymentScope;
  bucket: string;
  matcherAddress: string;
  signMessage: (message: string) => Promise<string>;
  limit?: number;
  s3Client?: S3Client;
}): Promise<AuditObjectPrivacyRepairResult> {
  const rows = await db.select()
    .from(matchesTable)
    .where(and(
      eq(matchesTable.chainId, input.scope.chainId),
      eq(matchesTable.dexAddress, input.scope.dexAddress),
      isNotNull(matchesTable.auditS3Key),
    ))
    .orderBy(desc(matchesTable.publishedAt), desc(matchesTable.id))
    .limit(input.limit ?? 25);

  const issues: AuditObjectPrivacyIssue[] = [];
  let checked = 0;
  let rewritten = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.auditS3Key) continue;
    checked++;
    try {
      const transcript = await fetchAuditTranscript(input.s3Client ?? defaultS3Client, input.bucket, row.auditS3Key);
      const schema = typeof transcript.schema === "string" ? transcript.schema : null;
      const forbiddenFields = forbiddenAuditFields(transcript);
      if (schema === RECEIPT_V2_SCHEMA && forbiddenFields.length === 0) {
        skipped++;
        continue;
      }

      const verification = await verifyAuditTranscriptFromS3({
        bucket: input.bucket,
        key: row.auditS3Key,
        match: row,
        matcherAddress: input.matcherAddress,
        s3Client: input.s3Client ?? defaultS3Client,
      });
      if (!verification.ok) {
        failed++;
        issues.push({
          code: "AUDIT_SCAN_FAILED",
          matchId: row.id.toString(),
          batchId: row.batchId.toString(),
          schema,
        });
        continue;
      }

      await writeAuditLog(
        input.bucket,
        row.auditS3Key,
        buildReceiptOnlyAuditBody(verification.proofReceipt, row),
        input.signMessage,
      );
      rewritten++;
    } catch {
      failed++;
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
    rewritten,
    skipped,
    failed,
    issues,
  };
}

export function buildReceiptOnlyAuditBody(receipt: AuditProofReceipt, match: AuditMatchRow) {
  return {
    schema: RECEIPT_V2_SCHEMA,
    matchId: receipt.matchId,
    batchId: receipt.batchId,
    pairId: receipt.pairId,
    orderAId: receipt.orderAId,
    orderBId: receipt.orderBId,
    auctionAlgorithm: "uniform-clearing-v1",
    clearingPriceQuotePerBaseScaled: match.clearingPriceNum,
    baseFilled: match.baseFilled,
    quoteFilled: match.quoteFilled,
    privateInputRoot: receipt.commitments.privateInputRoot,
    privateInputCount: receipt.commitments.privateInputCount,
    outputRoot: receipt.commitments.outputRoot,
    outputMatchCount: receipt.commitments.outputMatchCount,
    salted: receipt.commitments.salted,
    publishedAt: receipt.checks.publishedAt,
    txHash: receipt.publishTxHash,
    matcherAddress: receipt.matcherSignature.expectedSigner,
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
