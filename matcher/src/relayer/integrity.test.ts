import { describe, expect, it } from "vitest";
import { buildRelayerIntegrityReport } from "./integrity.js";

describe("relayer integrity report", () => {
  it("summarizes commitment and nullifier accounting gaps", async () => {
    const db = fakeExecuteDb([
      { rows: [{ value: 2 }] },
      { rows: [{ value: 1 }] },
      { rows: [{ value: 3 }] },
      { rows: [{ value: 4 }] },
    ]);

    await expect(buildRelayerIntegrityReport(db as any, {
      chainId: 421614,
      dexAddress: "0x08d59a1f305ed0107040f9b83615518310b292f4",
    })).resolves.toEqual({
      ok: false,
      ordersMissingCommitments: 2,
      invalidOrderCommitmentRows: 1,
      orderAccountCommitmentMismatchRows: 3,
      settledOrdersMissingConsumedNullifiers: 4,
    });
  });
});

function fakeExecuteDb(results: unknown[]) {
  return {
    execute: async () => {
      const next = results.shift();
      if (!next) throw new Error("unexpected execute call");
      return next;
    },
  };
}
