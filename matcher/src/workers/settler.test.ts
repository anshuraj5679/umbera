import { describe, expect, it } from "vitest";
import { assertBatchProofAnchorMatches, assertSettlementMatchReady, assertSettlementReceiptSucceeded } from "./settler.js";

describe("settlement readiness", () => {
  it("blocks settlement until the match is indexed", () => {
    expect(() => assertSettlementMatchReady(null)).toThrow("match is not indexed");
  });

  it("blocks settlement until an audit transcript is attached", () => {
    expect(() => assertSettlementMatchReady({ id: 12n, auditS3Key: null })).toThrow("has no audit transcript");
  });

  it("allows settlement when indexed audit evidence exists", () => {
    expect(() => assertSettlementMatchReady({ id: 12n, auditS3Key: "pair-0/batch-1/match-12.json" })).not.toThrow();
  });

  it("requires a successful chain receipt before DB settlement", () => {
    expect(() => assertSettlementReceiptSucceeded(null)).toThrow("missing transaction receipt");
    expect(() => assertSettlementReceiptSucceeded({ hash: "0xabc", status: 0 })).toThrow("receipt status 0");
    expect(() => assertSettlementReceiptSucceeded({ hash: "0xabc", status: null })).toThrow("receipt status unknown");
    expect(() => assertSettlementReceiptSucceeded({ hash: "0xabc", status: 1 })).not.toThrow();
  });

  it("blocks proof-backed settlement until the batch anchor matches the recomputed receipt", () => {
    const receipt = {
      auditedMatchCount: 2,
      allChecksOk: true,
      allSalted: true,
      roots: {
        matchReceiptRoot: "0x" + "11".repeat(32),
        transcriptDigestRoot: "0x" + "22".repeat(32),
        privateInputRoot: "0x" + "33".repeat(32),
        outputRoot: "0x" + "44".repeat(32),
      },
    } as any;

    expect(() => assertBatchProofAnchorMatches({
      batchId: 7n,
      anchor: null,
      receipt,
    })).toThrow("proof anchor is missing");

    expect(() => assertBatchProofAnchorMatches({
      batchId: 7n,
      anchor: {
        proofMatchReceiptRoot: "0x" + "aa".repeat(32),
        proofTranscriptDigestRoot: receipt.roots.transcriptDigestRoot,
        proofPrivateInputRoot: receipt.roots.privateInputRoot,
        proofOutputRoot: receipt.roots.outputRoot,
        proofMatchCount: 2,
        proofAllSalted: true,
        proofAnchoredAt: new Date("2026-06-01T00:00:00.000Z"),
      },
      receipt,
    })).toThrow("does not match recomputed receipt");

    expect(() => assertBatchProofAnchorMatches({
      batchId: 7n,
      anchor: {
        proofMatchReceiptRoot: receipt.roots.matchReceiptRoot,
        proofTranscriptDigestRoot: receipt.roots.transcriptDigestRoot,
        proofPrivateInputRoot: receipt.roots.privateInputRoot,
        proofOutputRoot: receipt.roots.outputRoot,
        proofMatchCount: 2,
        proofAllSalted: true,
        proofAnchoredAt: new Date("2026-06-01T00:00:00.000Z"),
      },
      receipt,
    })).not.toThrow();
  });
});
