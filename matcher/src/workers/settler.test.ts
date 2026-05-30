import { describe, expect, it } from "vitest";
import { assertSettlementMatchReady, assertSettlementReceiptSucceeded } from "./settler.js";

describe("settlement readiness", () => {
  it("blocks settlement until the match is indexed", () => {
    expect(() => assertSettlementMatchReady(null)).toThrow("match is not indexed");
  });

  it("blocks settlement until an audit transcript is attached", () => {
    expect(() => assertSettlementMatchReady({ id: 12n, auditS3Key: null })).toThrow("has no audit transcript");
  });

  it("allows settlement when indexed audit evidence exists", () => {
    expect(() => assertSettlementMatchReady({ id: 12n, auditS3Key: "pair-0/batch-1/match-12.json" })).not.toThrow();
  });

  it("requires a successful chain receipt before DB settlement", () => {
    expect(() => assertSettlementReceiptSucceeded(null)).toThrow("missing transaction receipt");
    expect(() => assertSettlementReceiptSucceeded({ hash: "0xabc", status: 0 })).toThrow("receipt status 0");
    expect(() => assertSettlementReceiptSucceeded({ hash: "0xabc", status: null })).toThrow("receipt status unknown");
    expect(() => assertSettlementReceiptSucceeded({ hash: "0xabc", status: 1 })).not.toThrow();
  });
});
