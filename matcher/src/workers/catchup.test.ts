import { describe, expect, it } from "vitest";
import { catchupEventNames } from "./catchup.js";

describe("catchup event discovery", () => {
  it("includes batch proof anchors when the deployed ABI supports them", () => {
    const dex = fakeDex([
      "OrderSubmitted",
      "OrderSubmittedPrivate",
      "BatchClosed",
      "MatchPublished",
      "MatchDisputed",
      "MatchSettled",
      "BatchProofAnchored",
    ]);

    expect(catchupEventNames(dex as any)).toContain("BatchProofAnchored");
  });

  it("skips optional events missing from older ABIs", () => {
    const dex = fakeDex([
      "OrderSubmitted",
      "BatchClosed",
      "MatchPublished",
      "MatchDisputed",
      "MatchSettled",
    ]);

    expect(catchupEventNames(dex as any)).not.toContain("BatchProofAnchored");
    expect(catchupEventNames(dex as any)).not.toContain("OrderSubmittedPrivate");
  });
});

function fakeDex(names: string[]) {
  return {
    interface: {
      getEvent: (name: string) => {
        if (!names.includes(name)) throw new Error("unknown event");
        return { name };
      },
    },
    filters: Object.fromEntries(names.map((name) => [name, () => ({ name })])),
  };
}
