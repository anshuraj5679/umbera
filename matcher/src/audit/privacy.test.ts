import { describe, expect, it } from "vitest";
import { buildReceiptOnlyAuditBody, forbiddenAuditFields, scanAuditObjectPrivacy } from "./privacy.js";

describe("audit object privacy scanner", () => {
  it("flags legacy schemas and private fields in receipt-v2 objects", async () => {
    const db = fakeMatchDb([
      { id: 1n, batchId: 9n, auditS3Key: "legacy.json" },
      { id: 2n, batchId: 9n, auditS3Key: "receipt.json" },
      { id: 3n, batchId: 9n, auditS3Key: "bad-receipt.json" },
    ]);
    const s3Client = {
      send: async (command: any) => ({
      Body: {
        transformToString: async () => JSON.stringify(
          command.input.Key === "legacy.json"
            ? {
              schema: "match-v2-private-auction-inputs",
              auction: {
                inputOrders: [
                  { id: "1", side: "BUY", remainingDeposit: "100", remainingRequest: "1" },
                ],
              },
            }
            : command.input.Key === "bad-receipt.json"
              ? {
                schema: "umbra.match.proof-receipt.v2",
                privateInputRoot: "root",
                outputRoot: "root",
                auction: { inputOrders: [{ side: "BUY" }] },
              }
              : {
                schema: "umbra.match.proof-receipt.v2",
                privateInputRoot: "root",
                outputRoot: "root",
              },
        ),
      },
    }),
    };

    const scan = await scanAuditObjectPrivacy(db as any, {
      scope: { chainId: 421614, dexAddress: "0xdex" },
      bucket: "audit-bucket",
      s3Client: s3Client as any,
    });

    expect(scan).toMatchObject({
      checked: 3,
      legacySchemaCount: 1,
      forbiddenFieldCount: 1,
      failedCount: 0,
    });
    expect(scan.issues).toEqual([
      { code: "LEGACY_AUDIT_SCHEMA", matchId: "1", batchId: "9", schema: "match-v2-private-auction-inputs" },
      {
        code: "AUDIT_PRIVATE_FIELDS",
        matchId: "3",
        batchId: "9",
        schema: "umbra.match.proof-receipt.v2",
        forbiddenFields: ["auction", "inputOrders", "side"],
      },
    ]);
  });

  it("does not treat receipt commitment roots as private transcript fields", () => {
    expect(forbiddenAuditFields({
      schema: "umbra.match.proof-receipt.v2",
      privateInputRoot: "root",
      outputRoot: "root",
      commitments: { salted: true },
    })).toEqual([]);
  });

  it("builds receipt-only replacement bodies without private transcript values", () => {
    const body = buildReceiptOnlyAuditBody({
      schema: "umbra.match.proof-receipt.v1",
      matchId: "42",
      batchId: "7",
      pairId: 0,
      chainId: 421614,
      dexAddress: "0xdex",
      orderAId: "9",
      orderBId: "11",
      publishTxHash: "0xabc",
      transcriptDigest: { stored: "old", recomputed: "old", ok: true },
      matcherSignature: { signer: "0xmatcher", expectedSigner: "0xmatcher", ok: true },
      checks: {
        fieldsOk: true,
        auctionRecomputed: true,
        auctionOk: true,
        transcriptSchema: "match-v2-private-auction-inputs",
        publishedAt: "2026-06-01T00:00:00.000Z",
      },
      commitments: {
        privateInputRoot: "input-root",
        privateInputCount: 2,
        outputRoot: "output-root",
        outputMatchCount: 1,
        salted: true,
      },
    }, {
      id: 42n,
      batchId: 7n,
      pairId: 0,
      buyOrderId: 11n,
      sellOrderId: 9n,
      clearingPriceNum: "3200000000000",
      baseFilled: "1600000000",
      quoteFilled: "500000000000000000",
      publishTxHash: "0xabc",
      auditS3Key: "pair-0/batch-7/match-42.json",
    });

    expect(body).toMatchObject({
      schema: "umbra.match.proof-receipt.v2",
      matchId: "42",
      batchId: "7",
      orderAId: "9",
      orderBId: "11",
      clearingPriceQuotePerBaseScaled: "3200000000000",
      baseFilled: "1600000000",
      quoteFilled: "500000000000000000",
      privateInputRoot: "input-root",
      outputRoot: "output-root",
      salted: true,
      txHash: "0xabc",
      matcherAddress: "0xmatcher",
    });
    expect(JSON.stringify(body)).not.toContain("inputOrders");
    expect(JSON.stringify(body)).not.toContain("remainingDeposit");
    expect(JSON.stringify(body)).not.toContain("BUY");
  });
});

function fakeMatchDb(rows: any[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => rows,
          }),
        }),
      }),
    }),
  };
}
