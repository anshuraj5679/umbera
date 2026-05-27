import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { digest } from "./signer.js";
import { verifyAuditTranscript, type AuditMatchRow } from "./verifier.js";

const match: AuditMatchRow = {
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
  });
});
