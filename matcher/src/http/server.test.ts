import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { publicAuditVerificationRow, publicBatchAuditVerificationRow, publicMatchRow, publicOrderRow, startHttp } from "./server.js";

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
      encRemainingBaseDepositHandle: "101",
      encRemainingQuoteDepositHandle: "102",
      encRemainingBaseRequestHandle: "103",
      encRemainingQuoteRequestHandle: "104",
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
    expect("encRemainingBaseDepositHandle" in row).toBe(false);
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
      proofReceipt: {
        schema: "umbra.match.proof-receipt.v1",
        matchId: "3",
        batchId: "52",
        pairId: 0,
        chainId: 421614,
        dexAddress: "0x1111111111111111111111111111111111111111",
        orderAId: "10",
        orderBId: "11",
        publishTxHash: "0xpublish",
        transcriptDigest: { stored: "stored-digest", recomputed: "computed-digest", ok: true },
        matcherSignature: { signer: "0xabc", expectedSigner: "0xabc", ok: true },
        checks: {
          fieldsOk: true,
          auctionRecomputed: true,
          auctionOk: true,
          transcriptSchema: "match-v2-private-auction-inputs",
          publishedAt: "2026-05-27T12:17:17.167Z",
        },
        commitments: {
          privateInputRoot: "input-root",
          privateInputCount: 2,
          outputRoot: "output-root",
          outputMatchCount: 1,
          salted: true,
        },
      },
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
      receipt: {
        schema: "umbra.match.proof-receipt.v1",
        matchId: "3",
        batchId: "52",
        pairId: 0,
        chainId: 421614,
        dexAddress: "0x1111111111111111111111111111111111111111",
        orderAId: "10",
        orderBId: "11",
        publishTxHash: "0xpublish",
        transcriptDigest: { stored: "stored-digest", recomputed: "computed-digest", ok: true },
        matcherSignature: { signer: "0xabc", expectedSigner: "0xabc", ok: true },
        checks: {
          fieldsOk: true,
          auctionRecomputed: true,
          auctionOk: true,
          transcriptSchema: "match-v2-private-auction-inputs",
          publishedAt: "2026-05-27T12:17:17.167Z",
        },
        commitments: {
          privateInputRoot: "input-root",
          privateInputCount: 2,
          outputRoot: "output-root",
          outputMatchCount: 1,
          salted: true,
        },
      },
    });
    expect("bucket" in row).toBe(false);
    expect("key" in row).toBe(false);
    expect(JSON.stringify(row)).not.toContain("private input orders");
    expect(JSON.stringify(row)).not.toContain("remainingDeposit");
    expect(JSON.stringify(row)).not.toContain("BUY");
  });

  it("builds a redacted batch proof receipt from match receipts", () => {
    const row = (publicBatchAuditVerificationRow as any)({
      batchId: 52n,
      chainId: 421614,
      dexAddress: "0x1111111111111111111111111111111111111111",
      totalMatchCount: 2,
      missingAuditMatchIds: ["4"],
      failedAuditMatchIds: [],
      verifications: [
        {
          ok: true,
          bucket: "private-bucket",
          key: "pair-0/batch-52/match-3.json",
          matchId: "3",
          digest: { ok: true, stored: "stored-digest", recomputed: "computed-digest" },
          signature: { ok: true, signer: "0xabc", expectedSigner: "0xabc" },
          fields: { matchId: true, batchId: true },
          auction: { recomputed: true, ok: true, reason: "contains private input orders" },
          transcript: { schema: "match-v2-private-auction-inputs", publishedAt: "2026-05-27T12:17:17.167Z" },
          proofReceipt: {
            schema: "umbra.match.proof-receipt.v1",
            matchId: "3",
            batchId: "52",
            pairId: 0,
            chainId: 421614,
            dexAddress: "0x1111111111111111111111111111111111111111",
            orderAId: "10",
            orderBId: "11",
            publishTxHash: "0xpublish",
            transcriptDigest: { stored: "stored-digest", recomputed: "computed-digest", ok: true },
            matcherSignature: { signer: "0xabc", expectedSigner: "0xabc", ok: true },
            checks: {
              fieldsOk: true,
              auctionRecomputed: true,
              auctionOk: true,
              transcriptSchema: "match-v2-private-auction-inputs",
              publishedAt: "2026-05-27T12:17:17.167Z",
            },
            commitments: {
              privateInputRoot: "input-root",
              privateInputCount: 2,
              outputRoot: "output-root",
              outputMatchCount: 1,
              salted: true,
            },
          },
        },
      ],
    });

    expect(row.ok).toBe(false);
    expect(row.batchId).toBe("52");
    expect(row.receipt).toMatchObject({
      schema: "umbra.batch.proof-receipt.v1",
      batchId: "52",
      chainId: 421614,
      dexAddress: "0x1111111111111111111111111111111111111111",
      totalMatchCount: 2,
      auditedMatchCount: 1,
      missingAuditCount: 1,
      failedAuditCount: 0,
      allChecksOk: true,
      allSalted: true,
      matchIds: ["3"],
      missingAuditMatchIds: ["4"],
      failedAuditMatchIds: [],
    });
    expect(row.receipt.roots.matchReceiptRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(row.receipt.roots.transcriptDigestRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(row.receipt.roots.privateInputRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(row.receipt.roots.outputRoot).toMatch(/^[0-9a-f]{64}$/);
    expect("bucket" in row).toBe(false);
    expect("key" in row).toBe(false);
    expect(JSON.stringify(row)).not.toContain("private input orders");
    expect(JSON.stringify(row)).not.toContain("remainingDeposit");
    expect(JSON.stringify(row)).not.toContain("BUY");
  });

  it("compares batch proof receipts against on-chain anchors", () => {
    const baseInput = {
      batchId: 52n,
      chainId: 421614,
      dexAddress: "0x1111111111111111111111111111111111111111",
      totalMatchCount: 1,
      missingAuditMatchIds: [],
      failedAuditMatchIds: [],
      verifications: [
        {
          ok: true,
          bucket: "private-bucket",
          key: "pair-0/batch-52/match-3.json",
          matchId: "3",
          digest: { ok: true, stored: "stored-digest", recomputed: "computed-digest" },
          signature: { ok: true, signer: "0xabc", expectedSigner: "0xabc" },
          fields: { matchId: true, batchId: true },
          auction: { recomputed: true, ok: true, reason: "contains private input orders" },
          transcript: { schema: "match-v2-private-auction-inputs", publishedAt: "2026-05-27T12:17:17.167Z" },
          proofReceipt: {
            schema: "umbra.match.proof-receipt.v1",
            matchId: "3",
            batchId: "52",
            pairId: 0,
            chainId: 421614,
            dexAddress: "0x1111111111111111111111111111111111111111",
            orderAId: "10",
            orderBId: "11",
            publishTxHash: "0xpublish",
            transcriptDigest: { stored: "stored-digest", recomputed: "computed-digest", ok: true },
            matcherSignature: { signer: "0xabc", expectedSigner: "0xabc", ok: true },
            checks: {
              fieldsOk: true,
              auctionRecomputed: true,
              auctionOk: true,
              transcriptSchema: "match-v2-private-auction-inputs",
              publishedAt: "2026-05-27T12:17:17.167Z",
            },
            commitments: {
              privateInputRoot: "input-root",
              privateInputCount: 2,
              outputRoot: "output-root",
              outputMatchCount: 1,
              salted: true,
            },
          },
        },
      ],
    };
    const unanchored = (publicBatchAuditVerificationRow as any)(baseInput);
    const anchored = (publicBatchAuditVerificationRow as any)({
      ...baseInput,
      anchor: {
        matchReceiptRoot: `0x${unanchored.receipt.roots.matchReceiptRoot}`,
        transcriptDigestRoot: `0x${unanchored.receipt.roots.transcriptDigestRoot}`,
        privateInputRoot: `0x${unanchored.receipt.roots.privateInputRoot}`,
        outputRoot: `0x${unanchored.receipt.roots.outputRoot}`,
        matchCount: 1,
        allSalted: true,
        anchoredAt: "2026-05-29T00:00:00.000Z",
        txHash: "0xanchor",
      },
    });

    expect(unanchored.anchored.ok).toBe(false);
    expect(anchored.anchored.ok).toBe(true);
    expect(JSON.stringify(anchored)).not.toContain("private-bucket");
    expect(JSON.stringify(anchored)).not.toContain("pair-0/batch-52");
  });

  it("applies x402 protection before issuing agent access tokens", async () => {
    const server = startHttp(
      0,
      {} as any,
      "0x1111111111111111111111111111111111111111",
      async () => {},
      {
        orderService: { capabilities: () => ({ ok: true }) } as any,
        paymentMiddleware: (req, res, next) => {
          if (req.path === "/agent/access") {
            return res.status(402).json({ error: "x402 payment required" });
          }
          return next();
        },
        x402Enabled: true,
        accessTokenSecret: "test-secret",
        accessTokenTtlSec: 60,
        accessMaxUses: 1,
      },
      {
        dex: {} as any,
        dexAddress: "0x1111111111111111111111111111111111111111",
        chainId: 421614,
        pairs: [],
        disputeWindowSec: 300,
        matchDelaySec: 15,
        confirmationDepth: 12,
      },
    );
    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/agent/access`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = await response.json();

      expect(response.status).toBe(402);
      expect(body).toEqual({ error: "x402 payment required" });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
