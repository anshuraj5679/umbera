import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { matches as matchesTable } from "../db/schema.js";
import type { DeploymentScope } from "../orders/lifecycle.js";

export type AuditRepairResult = {
  checked: number;
  repaired: number;
  missing: number;
  failed: number;
};

export type AuditRepairOptions = {
  intervalSec?: number;
  batchSize?: number;
  s3Client?: Pick<S3Client, "send">;
};

const defaultS3Client = new S3Client({ region: process.env.S3_REGION ?? "ap-south-1" });

export function candidateAuditS3Key(match: { pairId: number; batchId: bigint; id: bigint }) {
  return `pair-${match.pairId}/batch-${match.batchId.toString()}/match-${match.id.toString()}.json`;
}

export function startAuditRepairWorker(
  db: Db,
  scope: DeploymentScope,
  bucket: string,
  options: AuditRepairOptions = {},
) {
  const intervalSec = options.intervalSec ?? 300;
  if (intervalSec <= 0) return;
  const batchSize = options.batchSize ?? 25;
  const s3Client = options.s3Client ?? defaultS3Client;
  let running = false;

  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const result = await repairMissingAuditKeys(db, scope, bucket, { batchSize, s3Client });
      if (result.repaired > 0 || result.failed > 0) {
        console.log("audit key repair scan", result);
      }
    } catch (error) {
      console.error("audit key repair failed:", error instanceof Error ? error.message : String(error));
    } finally {
      running = false;
    }
  }, intervalSec * 1000);
}

export async function repairMissingAuditKeys(
  db: Db,
  scope: DeploymentScope,
  bucket: string,
  options: Pick<AuditRepairOptions, "batchSize" | "s3Client"> = {},
): Promise<AuditRepairResult> {
  const s3Client = options.s3Client ?? defaultS3Client;
  const rows = await db.select()
    .from(matchesTable)
    .where(and(
      eq(matchesTable.chainId, scope.chainId),
      eq(matchesTable.dexAddress, scope.dexAddress),
      isNull(matchesTable.auditS3Key),
    ))
    .orderBy(asc(matchesTable.batchId), asc(matchesTable.id))
    .limit(options.batchSize ?? 25);

  let repaired = 0;
  let missing = 0;
  let failed = 0;

  for (const row of rows) {
    const key = candidateAuditS3Key(row);
    try {
      const exists = await auditTranscriptExists(s3Client, bucket, key);
      if (!exists) {
        missing++;
        continue;
      }
      await db.update(matchesTable)
        .set({ auditS3Key: key })
        .where(and(
          eq(matchesTable.chainId, scope.chainId),
          eq(matchesTable.dexAddress, scope.dexAddress),
          eq(matchesTable.id, row.id),
          isNull(matchesTable.auditS3Key),
        ));
      repaired++;
    } catch {
      failed++;
    }
  }

  return { checked: rows.length, repaired, missing, failed };
}

export async function countMatchesMissingAuditKeys(db: Db, scope?: DeploymentScope): Promise<number> {
  const conditions = [isNull(matchesTable.auditS3Key)];
  if (scope) {
    conditions.unshift(eq(matchesTable.dexAddress, scope.dexAddress));
    conditions.unshift(eq(matchesTable.chainId, scope.chainId));
  }
  const row = await db.select({ value: sql<number>`count(*)::int` })
    .from(matchesTable)
    .where(and(...conditions))
    .then((rows) => rows[0]);
  return row?.value ?? 0;
}

async function auditTranscriptExists(s3Client: Pick<S3Client, "send">, bucket: string, key: string) {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error: any) {
    const status = Number(error?.$metadata?.httpStatusCode ?? 0);
    if (status === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") {
      return false;
    }
    throw error;
  }
}
