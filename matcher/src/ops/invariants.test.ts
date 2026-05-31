import { describe, expect, it } from "vitest";
import { buildPrivacyPostureReport } from "./invariants.js";

describe("privacy posture invariants", () => {
  it("reports blocking storage leaks and scrub-able operational residue", async () => {
    const db = fakeExecuteDb([
      { rows: [{ column_name: "plain_deposit" }] },
      { rows: [{ value: 3 }] },
      { rows: [{ value: 1 }] },
      { rows: [{ value: 2 }] },
      { rows: [{ value: 4 }] },
      { rows: [{ value: 5 }] },
      { rows: [{ value: 6 }] },
    ]);

    const report = await buildPrivacyPostureReport(db as any, {
      chainId: 421614,
      dexAddress: "0x08d59a1f305ed0107040f9b83615518310b292f4",
    });

    expect(report).toEqual({
      ok: false,
      blockingCount: 3,
      warningCount: 3,
      legacyOrderColumns: ["plain_deposit"],
      nonPrivateOrderSideRows: 3,
      agentAccessTokenHashInvalidRows: 1,
      expiredActiveAccessTokenRows: 2,
      residue: {
        agentSubmitOrderTaskRows: 4,
        taskEventRows: 5,
        workerErrorRows: 6,
      },
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
