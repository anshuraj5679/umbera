import { describe, expect, it } from "vitest";
import { countPrivateTaskResidue, scrubPrivateTaskResidue } from "./scrub.js";

describe("private task residue scrubber", () => {
  it("counts private residue across operational task tables", async () => {
    const db = fakeExecuteDb([
      { rows: [{ value: 2 }] },
      { rows: [{ value: "1" }] },
      { rows: [{ value: 0 }] },
    ]);

    await expect(countPrivateTaskResidue(db as any)).resolves.toEqual({
      agentSubmitOrderTaskRows: 2,
      taskEventRows: 1,
      workerErrorRows: 0,
    });
  });

  it("scrubs task payloads, task-event payloads, and worker-error payloads", async () => {
    const db = fakeExecuteDb([
      { rows: [{ value: 2 }] },
      { rows: [{ value: 1 }] },
      { rows: [{ value: 1 }] },
      { rowCount: 2 },
      { rowCount: 1 },
      { rowCount: 1 },
    ]);

    await expect(scrubPrivateTaskResidue(db as any)).resolves.toEqual({
      agentSubmitOrderTaskRows: 2,
      taskEventRows: 1,
      workerErrorRows: 1,
      updatedTaskRows: 2,
      updatedTaskEventRows: 1,
      updatedWorkerErrorRows: 1,
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
