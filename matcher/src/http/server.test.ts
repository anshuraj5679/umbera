import { describe, expect, it } from "vitest";
import { publicAuditVerificationRow, publicMatchRow, publicOrderRow } from "./server.js";

describe("public matcher API redaction", () => {
  it("does not expose private order-side or amount handles", () => {
    const row = publicOrderRow({
      id: 7n,
      pairId: 0,
      batchId: 3n,
      trader: "0xabc",
      side: "BUY",
      status: "ACTIVE",
      encBaseDepositHandle: "101",
      encQuoteDepositHandle: "102",
      encBaseRequestHandle: "103",
      encQuoteRequestHandle: "104",
      plainDeposit: "1000",
      plainRequest: "1",
      remainingBaseDeposit: "1000",
      remainingQuoteDeposit: "0",
      remainingBaseRequest: "0",
      remainingQuoteRequest: "1",
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
      expiry: 0n,
      submitTxHash: "0xsubmit",
    });

    expect(row).toEqual({
      id: "7",
      pairId: 0,
      batchId: "3",
      trader: "0xabc",
      accountCommitment: null,
      status: "ACTIVE",
      createdAt: "2026-05-26T00:00:00.000Z",
      expiry: "0",
      submitTxHash: "0xsubmit",
    });
    expect("side" in row).toBe(false);
    expect("plainDeposit" in row).toBe(false);
    expect("encBaseDepositHandle" in row).toBe(false);
  });

  it("redacts trader address when an account commitment is attached", () => {
    const row = publicOrderRow({
      id: 8n,
      pairId: 0,
      batchId: 3n,
      trader: "0xabc",
      accountCommitment: "0x3333333333333333333333333333333333333333333333333333333333333333",
      status: "ACTIVE",
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
      expiry: 0n,
      submitTxHash: "0xsubmit",
    });

    expect(row.trader).toBeNull();
    expect(row.accountCommitment).toBe("0x3333333333333333333333333333333333333333333333333333333333333333");
  });

  it("does not expose buy/sell-labeled match ids", () => {
    const row = publicMatchRow({
      id: 9n,
      batchId: 3n,
      pairId: 0,
      buyOrderId: 8n,
      sellOrderId: 5n,
      clearingPriceNum: "3200",
      clearingPriceDen: "1",
      baseFilled: "1600000000",
      quoteFilled: "500000000000000000",
      feeBase: "0",
      feeQuote: "0",
      status: "SETTLED",
      publishedAt: new Date("2026-05-26T00:01:00.000Z"),
      settledAt: new Date("2026-05-26T00:06:00.000Z"),
      auditS3Key: "audit/key.json",
      publishTxHash: "0xpublish",
      settleTxHash: "0xsettle",
    });

    expect(row.orderAId).toBe("5");
    expect(row.orderBId).toBe("8");
    expect("buyOrderId" in row).toBe(false);
    expect("sellOrderId" in row).toBe(false);
    expect("baseFilled" in row).toBe(false);
    expect("quoteFilled" in row).toBe(false);
    expect("auditS3Key" in row).toBe(false);
  });

  it("does not expose private audit verification internals", () => {
    const row = (publicAuditVerificationRow as any)({
      ok: true,
      bucket: "private-bucket",
      key: "pair-0/batch-52/match-3.json",
      matchId: "3",
      digest: { ok: true, stored: "stored-digest", recomputed: "computed-digest" },
      signature: { ok: true, signer: "0xabc", expectedSigner: "0xabc" },
      fields: { matchId: true, batchId: true },
      auction: { recomputed: true, ok: true, reason: "contains private input orders" },
      transcript: { schema: "match-v2-private-auction-inputs", publishedAt: "2026-05-27T12:17:17.167Z" },
    });

    expect(row).toEqual({
      ok: true,
      matchId: "3",
      digestOk: true,
      signatureOk: true,
      fieldsOk: true,
      auctionOk: true,
      auctionRecomputed: true,
      transcript: { schema: "match-v2-private-auction-inputs", publishedAt: "2026-05-27T12:17:17.167Z" },
    });
    expect("bucket" in row).toBe(false);
    expect("key" in row).toBe(false);
    expect(JSON.stringify(row)).not.toContain("stored-digest");
    expect(JSON.stringify(row)).not.toContain("private input orders");
  });
});
