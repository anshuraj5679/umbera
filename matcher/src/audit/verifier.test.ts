import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { digest } from "./signer.js";
import { verifyAuditTranscript, type AuditMatchRow } from "./verifier.js";

const match: AuditMatchRow = {
  chainId: 421614,
  dexAddress: "0x1111111111111111111111111111111111111111",
  id: 42n,
  batchId: 7n,
  pairId: 0,
  buyOrderId: 11n,
  sellOrderId: 9n,
  clearingPriceNum: "3200000000000",
  clearingPriceDen: "1000000000",
  baseFilled: "1600000000",
  quoteFilled: "500000000000000000",
  publishTxHash: "0xabc123",
  auditS3Key: "pair-0/batch-7/match-42.json",
};

describe("audit verifier", () => {
  it("verifies digest, matcher signature, and indexed match fields", async () => {
    const wallet = Wallet.createRandom();
    const body = {
      matchId: "42",
      batchId: "7",
      pairId: 0,
      orderAId: "9",
      orderBId: "11",
      clearingPriceQuotePerBase: "3200",
      clearingPriceQuotePerBaseScaled: "3200000000000",
      baseFilled: "1600000000",
      quoteFilled: "500000000000000000",
      publishedAt: "2026-05-26T00:00:00.000Z",
      txHash: "0xAbC123",
      matcherAddress: wallet.address,
    };
    const d = digest(body);
    const transcript = {
      ...body,
      digest: d,
      signature: await wallet.signMessage(d),
    };

    const result = verifyAuditTranscript({
      bucket: "audit-bucket",
      key: "pair-0/batch-7/match-42.json",
      transcript,
      match,
      matcherAddress: wallet.address,
    });

    expect(result.ok).toBe(true);
    expect(result.digest.ok).toBe(true);
    expect(result.signature.ok).toBe(true);
    expect(result.signature.signer?.toLowerCase()).toBe(wallet.address.toLowerCase());
    expect(result.fields).toEqual({
      matchId: true,
      batchId: true,
      pairId: true,
      orderAId: true,
      orderBId: true,
      txHash: true,
      matcherAddress: true,
      clearingPriceQuotePerBaseScaled: true,
      baseFilled: true,
      quoteFilled: true,
    });
    expect(result.auction.recomputed).toBe(false);
    expect(result.proofReceipt).toMatchObject({
      schema: "umbra.match.proof-receipt.v1",
      matchId: "42",
      batchId: "7",
      pairId: 0,
      chainId: 421614,
      dexAddress: "0x1111111111111111111111111111111111111111",
      orderAId: "9",
      orderBId: "11",
      publishTxHash: "0xabc123",
      transcriptDigest: {
        stored: d,
        recomputed: d,
        ok: true,
      },
      matcherSignature: {
        expectedSigner: wallet.address,
        ok: true,
      },
      checks: {
        fieldsOk: true,
        auctionRecomputed: false,
        auctionOk: null,
        transcriptSchema: "match-v1",
        publishedAt: "2026-05-26T00:00:00.000Z",
      },
      commitments: {
        privateInputRoot: null,
        privateInputCount: null,
        outputRoot: null,
        outputMatchCount: 1,
        salted: false,
      },
    });
  });

  it("marks tampered transcripts invalid without exposing transcript payloads", async () => {
    const wallet = Wallet.createRandom();
    const body = {
      matchId: "42",
      batchId: "7",
      pairId: 0,
      orderAId: "9",
      orderBId: "11",
      clearingPriceQuotePerBaseScaled: "3200000000000",
      baseFilled: "1600000000",
      quoteFilled: "500000000000000000",
      publishedAt: "2026-05-26T00:00:00.000Z",
      txHash: "0xabc123",
      matcherAddress: wallet.address,
    };
    const d = digest(body);
    const transcript = {
      ...body,
      txHash: "0xdeadbeef",
      digest: d,
      signature: await wallet.signMessage(d),
    };

    const result = verifyAuditTranscript({
      bucket: "audit-bucket",
      key: "pair-0/batch-7/match-42.json",
      transcript,
      match,
      matcherAddress: wallet.address,
    });

    expect(result.ok).toBe(false);
    expect(result.digest.ok).toBe(false);
    expect(result.fields.txHash).toBe(false);
    expect("transcript" in result && "txHash" in (result as any).transcript).toBe(false);
  });

  it("recomputes the auction when the private transcript includes input orders", async () => {
    const wallet = Wallet.createRandom();
    const recomputableMatch: AuditMatchRow = {
      ...match,
      buyOrderId: 11n,
      sellOrderId: 9n,
      clearingPriceNum: "3100000000000",
      baseFilled: "3100000000",
      quoteFilled: "1000000000000000000",
    };
    const body = {
      schema: "match-v2-private-auction-inputs",
      privateProofSalt: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      matchId: "42",
      batchId: "7",
      pairId: 0,
      matchIndex: 0,
      orderAId: "9",
      orderBId: "11",
      clearingPriceQuotePerBase: "3100",
      clearingPriceQuotePerBaseScaled: "3100000000000",
      baseFilled: "3100000000",
      quoteFilled: "1000000000000000000",
      auction: {
        cashDecimals: 6,
        assetDecimals: 18,
        inputOrders: [
          {
            id: "11",
            side: "BUY",
            remainingDeposit: "3200000000",
            remainingRequest: "1000000000000000000",
            cashDecimals: 6,
            assetDecimals: 18,
          },
          {
            id: "9",
            side: "SELL",
            remainingDeposit: "1000000000000000000",
            remainingRequest: "3000000000",
            cashDecimals: 6,
            assetDecimals: 18,
          },
        ],
        matches: [
          {
            buyOrderId: "11",
            sellOrderId: "9",
            cashAmount: "3100000000",
            assetAmount: "1000000000000000000",
          },
        ],
      },
      publishedAt: "2026-05-26T00:00:00.000Z",
      txHash: "0xabc123",
      matcherAddress: wallet.address,
    };
    const d = digest(body);

    const result = verifyAuditTranscript({
      bucket: "audit-bucket",
      key: "pair-0/batch-7/match-42.json",
      transcript: {
        ...body,
        digest: d,
        signature: await wallet.signMessage(d),
      },
      match: recomputableMatch,
      matcherAddress: wallet.address,
    });

    expect(result.ok).toBe(true);
    expect(result.auction).toEqual({
      recomputed: true,
      ok: true,
      reason: "Auction recomputation matched the private transcript and indexed match.",
    });
    expect(result.transcript.schema).toBe("match-v2-private-auction-inputs");
    expect(result.proofReceipt.commitments).toEqual({
      privateInputRoot: digest({
        schema: "umbra.audit.private-input-root.v1",
        privateProofSalt: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        inputOrders: body.auction.inputOrders,
      }),
      privateInputCount: 2,
      outputRoot: digest({
        schema: "umbra.audit.output-root.v1",
        privateProofSalt: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        matches: body.auction.matches,
      }),
      outputMatchCount: 1,
      salted: true,
    });
    expect(JSON.stringify(result.proofReceipt)).not.toContain("remainingDeposit");
    expect(JSON.stringify(result.proofReceipt)).not.toContain("BUY");
    expect(JSON.stringify(result.proofReceipt)).not.toContain("0123456789abcdef");
  });

  it("verifies receipt-only audit objects without decrypted auction inputs", async () => {
    const wallet = Wallet.createRandom();
    const body = {
      schema: "umbra.match.proof-receipt.v2",
      matchId: "42",
      batchId: "7",
      pairId: 0,
      matchIndex: 0,
      orderAId: "9",
      orderBId: "11",
      auctionAlgorithm: "uniform-clearing-v1",
      clearingPriceQuotePerBaseScaled: "3200000000000",
      baseFilled: "1600000000",
      quoteFilled: "500000000000000000",
      privateInputRoot: digest({ schema: "test.private-input-root", value: "committed-only" }),
      privateInputCount: 2,
      outputRoot: digest({ schema: "test.output-root", value: "committed-only" }),
      outputMatchCount: 1,
      salted: true,
      publishedAt: "2026-05-26T00:00:00.000Z",
      txHash: "0xabc123",
      matcherAddress: wallet.address,
    };
    const d = digest(body);

    const result = verifyAuditTranscript({
      bucket: "audit-bucket",
      key: "pair-0/batch-7/match-42.json",
      transcript: {
        ...body,
        digest: d,
        signature: await wallet.signMessage(d),
      },
      match,
      matcherAddress: wallet.address,
    });

    expect(result.ok).toBe(true);
    expect(result.auction).toMatchObject({ recomputed: false, ok: null });
    expect(result.transcript.schema).toBe("receipt-v2");
    expect(result.proofReceipt.schema).toBe("umbra.match.proof-receipt.v2");
    expect(result.proofReceipt.commitments).toEqual({
      privateInputRoot: body.privateInputRoot,
      privateInputCount: 2,
      outputRoot: body.outputRoot,
      outputMatchCount: 1,
      salted: true,
    });
    expect(JSON.stringify(result)).not.toContain("inputOrders");
    expect(JSON.stringify(result)).not.toContain("remainingDeposit");
    expect(JSON.stringify(result)).not.toContain("BUY");
  });
});
