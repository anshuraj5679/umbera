import { describe, expect, it } from "vitest";
import { forbiddenAuditFields, scanAuditObjectPrivacy } from "./privacy.js";

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
                schema: "obsidian.match.proof-receipt.v2",
                privateInputRoot: "root",
                outputRoot: "root",
                auction: { inputOrders: [{ side: "BUY" }] },
              }
              : {
                schema: "obsidian.match.proof-receipt.v2",
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
        schema: "obsidian.match.proof-receipt.v2",
        forbiddenFields: ["auction", "inputOrders", "side"],
      },
    ]);
  });

  it("does not treat receipt commitment roots as private transcript fields", () => {
    expect(forbiddenAuditFields({
      schema: "obsidian.match.proof-receipt.v2",
      privateInputRoot: "root",
      outputRoot: "root",
      commitments: { salted: true },
    })).toEqual([]);
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
