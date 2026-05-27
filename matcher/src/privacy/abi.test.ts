import { describe, expect, it } from "vitest";
import dexArtifact from "../../../shared/abi/DarkPoolDEX.json" with { type: "json" };

const abi = (dexArtifact as { abi: Array<{ type?: string; name?: string; inputs?: Array<{ name?: string }> }> }).abi;

describe("public DEX ABI privacy surface", () => {
  it("does not expose side or amounts in public order and match events", () => {
    for (const eventName of ["OrderSubmitted", "OrderSubmittedPrivate", "MatchPublished", "MatchSettled"]) {
      const event = abi.find((entry) => entry.type === "event" && entry.name === eventName);
      expect(event, `${eventName} event missing`).toBeTruthy();
      const names = (event?.inputs ?? []).map((input) => input.name?.toLowerCase() ?? "");
      expect(names).not.toContain("side");
      expect(names.some((name) => name.includes("amount"))).toBe(false);
      expect(names.some((name) => name.includes("price"))).toBe(false);
    }
  });

  it("submitOrder does not accept a public side argument", () => {
    const submit = abi.find((entry) => entry.type === "function" && entry.name === "submitOrder");
    expect(submit, "submitOrder missing").toBeTruthy();
    const names = (submit?.inputs ?? []).map((input) => input.name?.toLowerCase() ?? "");
    expect(names).not.toContain("side");
  });

  it("private account order event does not expose trader", () => {
    const event = abi.find((entry) => entry.type === "event" && entry.name === "OrderSubmittedPrivate");
    expect(event, "OrderSubmittedPrivate event missing").toBeTruthy();
    const names = (event?.inputs ?? []).map((input) => input.name?.toLowerCase() ?? "");
    expect(names).toContain("accountcommitment");
    expect(names).not.toContain("trader");
  });
});
