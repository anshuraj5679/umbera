import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ethers } from "ethers";
import { canonicalize, digest } from "./signer.js";
import { runAuction } from "../../../shared/auction/auction.js";
import type { AuctionMatch, DecryptedOrder } from "../../../shared/auction/types.js";

export type AuditMatchRow = {
  chainId?: number;
  dexAddress?: string;
  id: bigint;
  batchId: bigint;
  pairId: number;
  buyOrderId: bigint;
  sellOrderId: bigint;
  clearingPriceNum: string | null;
  clearingPriceDen?: string | null;
  baseFilled: string | null;
  quoteFilled: string | null;
  publishTxHash: string | null;
  auditS3Key: string | null;
};

export type AuditProofReceipt = {
  schema: "umbra.match.proof-receipt.v1" | "umbra.match.proof-receipt.v2" | "umbra.match.proof-receipt.v3";
  matchId: string;
  batchId: string;
  pairId: number;
  chainId: number | null;
  dexAddress: string | null;
  orderAId: string;
  orderBId: string;
  publishTxHash: string | null;
  transcriptDigest: {
    stored: string | null;
    recomputed: string;
    ok: boolean;
  };
  matcherSignature: {
    signer: string | null;
    expectedSigner: string;
    ok: boolean;
  };
  checks: {
    fieldsOk: boolean;
    auctionRecomputed: boolean;
    auctionOk: boolean | null;
    transcriptSchema: "match-v2-private-auction-inputs" | "match-v1" | "receipt-v2" | "legacy-or-unknown";
    publishedAt: string | null;
  };
  commitments: {
    privateInputRoot: string | null;
    privateInputCount: number | null;
    outputRoot: string | null;
    outputMatchCount: number | null;
    salted: boolean;
  };
};

export type BatchAuditProofReceipt = {
  schema: "umbra.batch.proof-receipt.v1";
  batchId: string;
  chainId: number | null;
  dexAddress: string | null;
  totalMatchCount: number;
  auditedMatchCount: number;
  missingAuditCount: number;
  failedAuditCount: number;
  allChecksOk: boolean;
  allSalted: boolean;
  matchIds: string[];
  missingAuditMatchIds: string[];
  failedAuditMatchIds: string[];
  roots: {
    matchReceiptRoot: string | null;
    transcriptDigestRoot: string | null;
    privateInputRoot: string | null;
    outputRoot: string | null;
  };
  receipts: AuditProofReceipt[];
};

export type AuditVerificationResult = {
  ok: boolean;
  bucket: string;
  key: string;
  matchId: string;
  digest: {
    ok: boolean;
    stored: string | null;
    recomputed: string;
  };
  signature: {
    ok: boolean;
    signer: string | null;
    expectedSigner: string;
  };
  fields: Record<string, boolean>;
  auction: {
    recomputed: boolean;
    ok: boolean | null;
    reason: string;
  };
  transcript: {
    schema: "match-v2-private-auction-inputs" | "match-v1" | "receipt-v2" | "legacy-or-unknown";
    publishedAt: string | null;
  };
  proofReceipt: AuditProofReceipt;
};

export function buildBatchProofReceipt(input: {
  batchId: bigint | string;
  chainId?: number | null;
  dexAddress?: string | null;
  totalMatchCount: number;
  receipts: AuditProofReceipt[];
  missingAuditMatchIds?: string[];
  failedAuditMatchIds?: string[];
}): BatchAuditProofReceipt {
  const batchId = input.batchId.toString();
  const receipts = [...input.receipts].sort(compareReceiptIds);
  const missingAuditMatchIds = [...(input.missingAuditMatchIds ?? [])].sort(compareNumericStrings);
  const failedAuditMatchIds = [...(input.failedAuditMatchIds ?? [])].sort(compareNumericStrings);
  const matchIds = receipts.map((receipt) => receipt.matchId);
  const allChecksOk = receipts.every((receipt) =>
    receipt.transcriptDigest.ok
    && receipt.matcherSignature.ok
    && receipt.checks.fieldsOk
    && (receipt.checks.auctionOk ?? true)
  );
  const allSalted = receipts.length > 0 && receipts.every((receipt) => receipt.commitments.salted);

  return {
    schema: "umbra.batch.proof-receipt.v1",
    batchId,
    chainId: input.chainId ?? receipts[0]?.chainId ?? null,
    dexAddress: input.dexAddress ?? receipts[0]?.dexAddress ?? null,
    totalMatchCount: input.totalMatchCount,
    auditedMatchCount: receipts.length,
    missingAuditCount: missingAuditMatchIds.length,
    failedAuditCount: failedAuditMatchIds.length,
    allChecksOk,
    allSalted,
    matchIds,
    missingAuditMatchIds,
    failedAuditMatchIds,
    roots: {
      matchReceiptRoot: receipts.length > 0
        ? digest({ schema: "umbra.batch.match-receipt-root.v1", batchId, receipts })
        : null,
      transcriptDigestRoot: receipts.length > 0
        ? digest({
          schema: "umbra.batch.transcript-digest-root.v1",
          batchId,
          transcriptDigests: receipts.map((receipt) => ({
            matchId: receipt.matchId,
            digest: receipt.transcriptDigest.recomputed,
            ok: receipt.transcriptDigest.ok,
          })),
        })
        : null,
      privateInputRoot: receipts.length > 0 && receipts.every((receipt) => receipt.commitments.privateInputRoot)
        ? digest({
          schema: "umbra.batch.private-input-root.v1",
          batchId,
          privateInputRoots: receipts.map((receipt) => ({
            matchId: receipt.matchId,
            root: receipt.commitments.privateInputRoot,
            count: receipt.commitments.privateInputCount,
          })),
        })
        : null,
      outputRoot: receipts.length > 0 && receipts.every((receipt) => receipt.commitments.outputRoot)
        ? digest({
          schema: "umbra.batch.output-root.v1",
          batchId,
          outputRoots: receipts.map((receipt) => ({
            matchId: receipt.matchId,
            root: receipt.commitments.outputRoot,
            count: receipt.commitments.outputMatchCount,
          })),
        })
        : null,
    },
    receipts,
  };
}

export class AuditVerificationError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AuditVerificationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const defaultS3Client = new S3Client({ region: process.env.S3_REGION ?? "ap-south-1" });

export async function verifyAuditTranscriptFromS3(input: {
  bucket: string;
  key: string;
  match: AuditMatchRow;
  matcherAddress: string;
  s3Client?: S3Client;
}): Promise<AuditVerificationResult> {
  const transcript = await fetchAuditTranscript(input.s3Client ?? defaultS3Client, input.bucket, input.key);
  return verifyAuditTranscript({
    bucket: input.bucket,
    key: input.key,
    transcript,
    match: input.match,
    matcherAddress: input.matcherAddress,
  });
}

export async function fetchAuditTranscript(s3Client: S3Client, bucket: string, key: string): Promise<Record<string, unknown>> {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) {
    throw new AuditVerificationError(502, "audit_body_missing", "Audit transcript object has no body.");
  }
  const raw = await bodyToString(response.Body);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("transcript must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuditVerificationError(502, "audit_json_invalid", `Audit transcript JSON is invalid: ${detail}`);
  }
}

export function verifyAuditTranscript(input: {
  bucket: string;
  key: string;
  transcript: Record<string, unknown>;
  match: AuditMatchRow;
  matcherAddress: string;
}): AuditVerificationResult {
  const storedDigest = stringField(input.transcript, "digest");
  const signature = stringField(input.transcript, "signature");
  if (!storedDigest) {
    throw new AuditVerificationError(422, "audit_digest_missing", "Audit transcript is missing digest.");
  }
  if (!signature) {
    throw new AuditVerificationError(422, "audit_signature_missing", "Audit transcript is missing signature.");
  }

  const unsigned = omit(input.transcript, ["digest", "signature"]);
  const recomputedDigest = digest(unsigned);
  const digestOk = storedDigest === recomputedDigest;
  const signer = recoverSigner(recomputedDigest, signature);
  const signatureOk = signer !== null && signer.toLowerCase() === input.matcherAddress.toLowerCase();

  const expectedOrderIds = neutralOrderIds(input.match);
  const orderAId = stringField(input.transcript, "orderAId") ?? stringField(input.transcript, "buyOrderId");
  const orderBId = stringField(input.transcript, "orderBId") ?? stringField(input.transcript, "sellOrderId");
  const fields: Record<string, boolean> = {
    matchId: stringField(input.transcript, "matchId") === input.match.id.toString(),
    batchId: stringField(input.transcript, "batchId") === input.match.batchId.toString(),
    pairId: numberField(input.transcript, "pairId") === input.match.pairId,
    orderAId: orderAId === expectedOrderIds.orderAId,
    orderBId: orderBId === expectedOrderIds.orderBId,
    txHash: normalizeHex(stringField(input.transcript, "txHash")) === normalizeHex(input.match.publishTxHash),
    matcherAddress: normalizeHex(stringField(input.transcript, "matcherAddress")) === normalizeHex(input.matcherAddress),
    clearingPriceQuotePerBaseScaled: stringField(input.transcript, "clearingPriceQuotePerBaseScaled") === input.match.clearingPriceNum,
    baseFilled: nullableStringField(input.transcript, "baseFilled") === input.match.baseFilled,
    quoteFilled: nullableStringField(input.transcript, "quoteFilled") === input.match.quoteFilled,
  };

  const auction = recomputeAuction(input.transcript, input.match);
  const transcript = {
    schema: transcriptSchema(input.transcript),
    publishedAt: stringField(input.transcript, "publishedAt"),
  };
  const ok = digestOk && signatureOk && Object.values(fields).every(Boolean) && (auction.ok ?? true);
  const proofReceipt = buildProofReceipt({
    transcript: input.transcript,
    match: input.match,
    matcherAddress: input.matcherAddress,
    storedDigest,
    recomputedDigest,
    digestOk,
    signer,
    signatureOk,
    fields,
    auction,
    transcriptMeta: transcript,
  });
  return {
    ok,
    bucket: input.bucket,
    key: input.key,
    matchId: input.match.id.toString(),
    digest: {
      ok: digestOk,
      stored: storedDigest,
      recomputed: recomputedDigest,
    },
    signature: {
      ok: signatureOk,
      signer,
      expectedSigner: input.matcherAddress,
    },
    fields,
    auction,
    transcript,
    proofReceipt,
  };
}

function recomputeAuction(transcript: Record<string, unknown>, match: AuditMatchRow) {
  const auction = objectField(transcript, "auction");
  const rawInputs = auction ? arrayField(auction, "inputOrders") : null;
  if (!auction || !rawInputs) {
    return {
      recomputed: false,
      ok: null,
      reason: "Transcript does not include private input orders, so this verifier validates signed output consistency only.",
    };
  }

  const inputOrders = parseInputOrders(rawInputs);
  if (!inputOrders) {
    return {
      recomputed: true,
      ok: false,
      reason: "Transcript auction input orders are malformed.",
    };
  }

  const result = runAuction(inputOrders);
  const target = result.matches.find((candidate) =>
    candidate.buyOrderId === match.buyOrderId && candidate.sellOrderId === match.sellOrderId
  );
  const rawTranscriptMatches = arrayField(auction, "matches");
  const transcriptMatches = parseAuctionMatches(rawTranscriptMatches);
  if (rawTranscriptMatches && !transcriptMatches) {
    return {
      recomputed: true,
      ok: false,
      reason: "Transcript auction matches are malformed.",
    };
  }
  const clearingOk =
    stringField(transcript, "clearingPriceQuotePerBaseScaled") === result.clearingPriceQuotePerBaseScaled.toString();
  const targetOk = !!target
    && target.cashAmount.toString() === match.baseFilled
    && target.assetAmount.toString() === match.quoteFilled;
  const transcriptMatchesOk = transcriptMatches === null
    ? true
    : sameAuctionMatches(transcriptMatches, result.matches);
  const ok = clearingOk && targetOk && transcriptMatchesOk;

  return {
    recomputed: true,
    ok,
    reason: ok
      ? "Auction recomputation matched the private transcript and indexed match."
      : "Auction recomputation did not match the private transcript or indexed match.",
  };
}

function recoverSigner(message: string, signature: string) {
  try {
    return ethers.verifyMessage(message, signature);
  } catch {
    return null;
  }
}

function neutralOrderIds(row: AuditMatchRow) {
  const [orderAId, orderBId] = row.buyOrderId < row.sellOrderId
    ? [row.buyOrderId, row.sellOrderId]
    : [row.sellOrderId, row.buyOrderId];
  return {
    orderAId: orderAId.toString(),
    orderBId: orderBId.toString(),
  };
}

function buildProofReceipt(input: {
  transcript: Record<string, unknown>;
  match: AuditMatchRow;
  matcherAddress: string;
  storedDigest: string | null;
  recomputedDigest: string;
  digestOk: boolean;
  signer: string | null;
  signatureOk: boolean;
  fields: Record<string, boolean>;
  auction: { recomputed: boolean; ok: boolean | null; reason: string };
  transcriptMeta: AuditVerificationResult["transcript"];
}): AuditProofReceipt {
  const ids = neutralOrderIds(input.match);
  const commitments = proofCommitments(input.transcript, input.match);
  return {
    schema: transcriptSchema(input.transcript) === "receipt-v2"
      ? "umbra.match.proof-receipt.v2"
      : "umbra.match.proof-receipt.v1",
    matchId: input.match.id.toString(),
    batchId: input.match.batchId.toString(),
    pairId: input.match.pairId,
    chainId: input.match.chainId ?? null,
    dexAddress: input.match.dexAddress ?? null,
    orderAId: ids.orderAId,
    orderBId: ids.orderBId,
    publishTxHash: input.match.publishTxHash,
    transcriptDigest: {
      stored: input.storedDigest,
      recomputed: input.recomputedDigest,
      ok: input.digestOk,
    },
    matcherSignature: {
      signer: input.signer,
      expectedSigner: input.matcherAddress,
      ok: input.signatureOk,
    },
    checks: {
      fieldsOk: Object.values(input.fields).every(Boolean),
      auctionRecomputed: input.auction.recomputed,
      auctionOk: input.auction.ok,
      transcriptSchema: input.transcriptMeta.schema,
      publishedAt: input.transcriptMeta.publishedAt,
    },
    commitments,
  };
}

function proofCommitments(transcript: Record<string, unknown>, match: AuditMatchRow): AuditProofReceipt["commitments"] {
  if (transcriptSchema(transcript) === "receipt-v2") {
    return {
      privateInputRoot: nullableStringField(transcript, "privateInputRoot"),
      privateInputCount: numberField(transcript, "privateInputCount"),
      outputRoot: nullableStringField(transcript, "outputRoot"),
      outputMatchCount: numberField(transcript, "outputMatchCount"),
      salted: transcript.salted === true,
    };
  }
  const auction = objectField(transcript, "auction");
  const inputOrders = auction ? arrayField(auction, "inputOrders") : null;
  const outputMatches = auction ? arrayField(auction, "matches") : null;
  const privateProofSalt = stringField(transcript, "privateProofSalt");
  const salted = isCommitmentSalt(privateProofSalt);
  const privateInputRoot = inputOrders && salted
    ? digest({
      schema: "umbra.audit.private-input-root.v1",
      privateProofSalt,
      inputOrders,
    })
    : null;
  const outputPayload = outputMatches ?? [{
    matchId: match.id.toString(),
    orderAId: neutralOrderIds(match).orderAId,
    orderBId: neutralOrderIds(match).orderBId,
    clearingPriceQuotePerBaseScaled: nullableStringField(transcript, "clearingPriceQuotePerBaseScaled"),
    baseFilled: nullableStringField(transcript, "baseFilled"),
    quoteFilled: nullableStringField(transcript, "quoteFilled"),
    txHash: stringField(transcript, "txHash"),
  }];
  const outputRoot = salted
    ? digest({
      schema: "umbra.audit.output-root.v1",
      privateProofSalt,
      matches: outputPayload,
    })
    : null;

  return {
    privateInputRoot,
    privateInputCount: inputOrders ? inputOrders.length : null,
    outputRoot,
    outputMatchCount: outputMatches ? outputMatches.length : outputPayload.length,
    salted,
  };
}

function isCommitmentSalt(value: string | null): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value);
}

function compareReceiptIds(a: AuditProofReceipt, b: AuditProofReceipt) {
  return compareNumericStrings(a.matchId, b.matchId);
}

function compareNumericStrings(a: string, b: string) {
  const left = /^\d+$/.test(a) ? BigInt(a) : null;
  const right = /^\d+$/.test(b) ? BigInt(b) : null;
  if (left !== null && right !== null) return left < right ? -1 : left > right ? 1 : 0;
  return a.localeCompare(b);
}

function omit(source: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!keys.includes(key)) out[key] = value;
  }
  return out;
}

function stringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

function nullableStringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

function numberField(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function objectField(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayField(source: Record<string, unknown>, key: string): unknown[] | null {
  const value = source[key];
  return Array.isArray(value) ? value : null;
}

function normalizeHex(value: string | null | undefined) {
  return value ? value.toLowerCase() : null;
}

function transcriptSchema(transcript: Record<string, unknown>): AuditVerificationResult["transcript"]["schema"] {
  const schema = stringField(transcript, "schema");
  if (schema === "umbra.match.proof-receipt.v3" || schema === "umbra.match.proof-receipt.v2") return "receipt-v2";
  if (schema === "match-v2-private-auction-inputs") return schema;
  if (stringField(transcript, "orderAId") && stringField(transcript, "orderBId")) return "match-v1";
  return "legacy-or-unknown";
}

function parseInputOrders(rawInputs: unknown[]): DecryptedOrder[] | null {
  const parsed: DecryptedOrder[] = [];
  for (const raw of rawInputs) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const side = stringField(row, "side");
    const id = parseBigIntString(stringField(row, "id"));
    const remainingDeposit = parseBigIntString(stringField(row, "remainingDeposit"));
    const remainingRequest = parseBigIntString(stringField(row, "remainingRequest"));
    const cashDecimals = numberField(row, "cashDecimals");
    const assetDecimals = numberField(row, "assetDecimals");
    if (
      (side !== "BUY" && side !== "SELL") ||
      id === null ||
      remainingDeposit === null ||
      remainingRequest === null ||
      cashDecimals === null ||
      assetDecimals === null
    ) {
      return null;
    }
    parsed.push({
      id,
      side,
      remainingDeposit,
      remainingRequest,
      cashDecimals,
      assetDecimals,
    });
  }
  return parsed;
}

function parseAuctionMatches(rawMatches: unknown[] | null): AuctionMatch[] | null {
  if (!rawMatches) return null;
  const parsed: AuctionMatch[] = [];
  for (const raw of rawMatches) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const buyOrderId = parseBigIntString(stringField(row, "buyOrderId"));
    const sellOrderId = parseBigIntString(stringField(row, "sellOrderId"));
    const cashAmount = parseBigIntString(stringField(row, "cashAmount"));
    const assetAmount = parseBigIntString(stringField(row, "assetAmount"));
    if (buyOrderId === null || sellOrderId === null || cashAmount === null || assetAmount === null) return null;
    parsed.push({ buyOrderId, sellOrderId, cashAmount, assetAmount });
  }
  return parsed;
}

function sameAuctionMatches(a: AuctionMatch[], b: AuctionMatch[]) {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    return !!right
      && left.buyOrderId === right.buyOrderId
      && left.sellOrderId === right.sellOrderId
      && left.cashAmount === right.cashAmount
      && left.assetAmount === right.assetAmount;
  });
}

function parseBigIntString(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

async function bodyToString(body: unknown): Promise<string> {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (hasTransformToString(body)) return body.transformToString();
  if (isAsyncIterable(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new AuditVerificationError(502, "audit_body_unsupported", "Audit transcript body type is unsupported.");
}

function hasTransformToString(value: unknown): value is { transformToString: () => Promise<string> } {
  return !!value && typeof (value as { transformToString?: unknown }).transformToString === "function";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Buffer | Uint8Array | string> {
  return !!value && typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}
