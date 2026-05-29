import type { Contract } from "ethers";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { batches as batchesTable, matches as matchesTable } from "../db/schema.js";
import { buildBatchProofReceipt, verifyAuditTranscriptFromS3, type BatchAuditProofReceipt } from "./verifier.js";
import { normalizeDexAddress, type DeploymentScope } from "../orders/lifecycle.js";

export type BatchAuditBuildResult = {
  receipt: BatchAuditProofReceipt;
  missingAuditMatchIds: string[];
  failedAuditMatchIds: string[];
};

export type BatchProofAnchorResult = {
  batchId: string;
  txHash: string;
  receipt: BatchAuditProofReceipt;
};

export async function buildVerifiedBatchAuditReceipt(input: {
  db: Db;
  batchId: bigint;
  chainId: number;
  dexAddress: string;
  auditBucket: string;
  matcherAddress: string;
}): Promise<BatchAuditBuildResult> {
  const scope = {
    chainId: input.chainId,
    dexAddress: normalizeDexAddress(input.dexAddress),
  };
  const rows = await input.db.select()
    .from(matchesTable)
    .where(and(
      eq(matchesTable.chainId, scope.chainId),
      eq(matchesTable.dexAddress, scope.dexAddress),
      eq(matchesTable.batchId, input.batchId),
    ))
    .orderBy(matchesTable.id);

  const receipts = [];
  const missingAuditMatchIds: string[] = [];
  const failedAuditMatchIds: string[] = [];

  for (const match of rows) {
    const matchId = match.id.toString();
    if (!match.auditS3Key) {
      missingAuditMatchIds.push(matchId);
      continue;
    }
    try {
      const verification = await verifyAuditTranscriptFromS3({
        bucket: input.auditBucket,
        key: match.auditS3Key,
        match,
        matcherAddress: input.matcherAddress,
      });
      receipts.push(verification.proofReceipt);
    } catch {
      failedAuditMatchIds.push(matchId);
    }
  }

  return {
    receipt: buildBatchProofReceipt({
      batchId: input.batchId,
      chainId: scope.chainId,
      dexAddress: scope.dexAddress,
      totalMatchCount: rows.length,
      receipts,
      missingAuditMatchIds,
      failedAuditMatchIds,
    }),
    missingAuditMatchIds,
    failedAuditMatchIds,
  };
}

export async function anchorBatchProof(input: {
  dex: Contract;
  db: Db;
  batchId: bigint;
  chainId: number;
  dexAddress: string;
  auditBucket: string;
  matcherAddress: string;
}): Promise<BatchProofAnchorResult> {
  const { receipt, missingAuditMatchIds, failedAuditMatchIds } = await buildVerifiedBatchAuditReceipt(input);
  assertAnchorable(receipt, missingAuditMatchIds, failedAuditMatchIds);

  const tx = await (input.dex as any).anchorBatchProof(
    input.batchId,
    toBytes32(receipt.roots.matchReceiptRoot),
    toBytes32(receipt.roots.transcriptDigestRoot),
    toBytes32(receipt.roots.privateInputRoot),
    toBytes32(receipt.roots.outputRoot),
    receipt.auditedMatchCount,
    receipt.allSalted,
  );
  const rcpt = await tx.wait();
  const scope: DeploymentScope = {
    chainId: input.chainId,
    dexAddress: normalizeDexAddress(input.dexAddress),
  };
  await input.db.update(batchesTable)
    .set({
      proofMatchReceiptRoot: toBytes32(receipt.roots.matchReceiptRoot),
      proofTranscriptDigestRoot: toBytes32(receipt.roots.transcriptDigestRoot),
      proofPrivateInputRoot: toBytes32(receipt.roots.privateInputRoot),
      proofOutputRoot: toBytes32(receipt.roots.outputRoot),
      proofMatchCount: receipt.auditedMatchCount,
      proofAllSalted: receipt.allSalted,
      proofAnchoredAt: new Date(),
      proofAnchorTxHash: rcpt.hash,
    })
    .where(and(
      eq(batchesTable.chainId, scope.chainId),
      eq(batchesTable.dexAddress, scope.dexAddress),
      eq(batchesTable.id, input.batchId),
    ));

  return {
    batchId: input.batchId.toString(),
    txHash: rcpt.hash,
    receipt,
  };
}

function assertAnchorable(
  receipt: BatchAuditProofReceipt,
  missingAuditMatchIds: string[],
  failedAuditMatchIds: string[],
) {
  if (receipt.auditedMatchCount === 0) {
    throw new Error(`batch ${receipt.batchId} has no audited matches to anchor`);
  }
  if (missingAuditMatchIds.length > 0 || failedAuditMatchIds.length > 0) {
    throw new Error(`batch ${receipt.batchId} audit coverage incomplete`);
  }
  if (!receipt.allChecksOk || !receipt.allSalted) {
    throw new Error(`batch ${receipt.batchId} proof receipt is not complete and salted`);
  }
  if (
    !receipt.roots.matchReceiptRoot ||
    !receipt.roots.transcriptDigestRoot ||
    !receipt.roots.privateInputRoot ||
    !receipt.roots.outputRoot
  ) {
    throw new Error(`batch ${receipt.batchId} proof roots are incomplete`);
  }
}

function toBytes32(root: string | null): `0x${string}` {
  if (!root || !/^(0x)?[0-9a-fA-F]{64}$/.test(root)) {
    throw new Error("invalid proof root");
  }
  return (root.startsWith("0x") ? root.toLowerCase() : `0x${root.toLowerCase()}`) as `0x${string}`;
}
