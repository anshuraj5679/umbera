import { describe, expect, it } from "vitest";
import { candidateAuditS3Key, repairMissingAuditKeys } from "./repair.js";

describe("audit repair", () => {
  it("builds deterministic audit transcript keys", () => {
    expect(candidateAuditS3Key({ pairId: 2, batchId: 386n, id: 7n }))
      .toBe("pair-2/batch-386/match-7.json");
  });

  it("repairs missing audit keys only when the deterministic S3 object exists", async () => {
    const rows = [
      { chainId: 421614, dexAddress: "0xdex", id: 1n, batchId: 9n, pairId: 0 },
      { chainId: 421614, dexAddress: "0xdex", id: 2n, batchId: 9n, pairId: 0 },
    ];
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => rows,
            }),
          }),
        }),
      }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: async () => {
            updates.push(patch);
          },
        }),
      }),
    };
    const s3Client = {
      send: async (command: any) => {
        if (command.input.Key === "pair-0/batch-9/match-1.json") return {};
        const error: any = new Error("not found");
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      },
    };

    const result = await repairMissingAuditKeys(db as any, {
      chainId: 421614,
      dexAddress: "0xdex",
    }, "audit-bucket", { s3Client: s3Client as any });

    expect(result).toEqual({ checked: 2, repaired: 1, missing: 1, failed: 0 });
    expect(updates).toEqual([{ auditS3Key: "pair-0/batch-9/match-1.json" }]);
  });
});
