import { describe, expect, it } from "vitest";
import {
  agentOrderIdempotencyKey,
  publicAgentOrderResult,
  sanitizeAgentOrderTaskPayload,
  sanitizeWorkerErrorPayload,
} from "./redaction.js";

describe("privacy redaction helpers", () => {
  it("hashes agent idempotency keys without storing the raw client id", () => {
    const key = agentOrderIdempotencyKey("client-order-123", "test-secret-123456");

    expect(key).toMatch(/^agent:sha256:[0-9a-f]{64}$/);
    expect(key).not.toContain("client-order-123");
  });

  it("sanitizes agent task payloads", () => {
    const payload = sanitizeAgentOrderTaskPayload({
      pairId: 0,
      side: "BUY",
      size: "0.5",
      limitPrice: "3200",
      clientOrderId: "private-client-id",
      agent: "alpha-agent",
    }, "test-secret-123456");

    expect(payload).toMatchObject({
      requestShape: "agent_order",
      pairId: 0,
      hasClientOrderId: true,
      hasAgent: true,
    });
    expect(JSON.stringify(payload)).not.toContain("BUY");
    expect(JSON.stringify(payload)).not.toContain("0.5");
    expect(JSON.stringify(payload)).not.toContain("3200");
    expect(JSON.stringify(payload)).not.toContain("private-client-id");
    expect(JSON.stringify(payload)).not.toContain("alpha-agent");
  });

  it("redacts agent order responses", () => {
    const result = publicAgentOrderResult({
      ok: true,
      txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      orderId: "9",
      batchId: "52",
      pairId: 0,
      expiry: "1779887404",
    });

    expect(result).toEqual({
      ok: true,
      txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      orderId: "9",
      batchId: "52",
      pairId: 0,
      expiry: "1779887404",
    });
    expect("side" in result).toBe(false);
    expect("trader" in result).toBe(false);
    expect("depositToken" in result).toBe(false);
    expect("clientOrderId" in result).toBe(false);
  });

  it("sanitizes worker error payloads", () => {
    const payload = sanitizeWorkerErrorPayload({
      batchId: "52",
      pairId: 0,
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      side: "SELL",
      size: "1.5",
      limitPrice: "3200",
      trader: "0x1111111111111111111111111111111111111111",
      error: "SELL failed for 0x1111111111111111111111111111111111111111 with 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    const serialized = JSON.stringify(payload);
    expect(payload).toMatchObject({ batchId: "52", pairId: 0 });
    expect(serialized).not.toContain("SELL");
    expect(serialized).not.toContain("1.5");
    expect(serialized).not.toContain("0x1111111111111111111111111111111111111111");
    expect(serialized).not.toContain("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });
});
