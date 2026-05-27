import { describe, expect, it } from "vitest";
import { isTaskLeaseExpired, isTaskRetryable, isTaskStale, publicTaskEventRow, publicTaskRow, type TaskEventRow, type TaskRow } from "./store.js";

describe("task public redaction", () => {
  it("exposes lifecycle metadata without private payloads or results", () => {
    const row: TaskRow = {
      id: "task-1",
      type: "AGENT_SUBMIT_ORDER",
      status: "COMPLETED",
      scope: "AGENT",
      accountId: "agent-alpha",
      trader: "0xabc",
      idempotencyKey: "agent:private-client-order",
      batchId: 12n,
      orderId: 34n,
      matchId: null,
      payload: { side: "BUY", size: "0.5", limitPrice: "3200" },
      result: { txHash: "0xtx", side: "BUY" },
      error: null,
      attempts: 1,
      maxAttempts: 3,
      nextRunAt: null,
      heartbeatAt: new Date("2026-05-26T00:00:01.000Z"),
      leaseOwner: "worker-private",
      leaseExpiresAt: new Date("2026-05-26T00:02:00.000Z"),
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
      startedAt: new Date("2026-05-26T00:00:01.000Z"),
      completedAt: new Date("2026-05-26T00:00:02.000Z"),
      updatedAt: new Date("2026-05-26T00:00:02.000Z"),
    };

    const publicRow = publicTaskRow(row);

    expect(publicRow).toEqual({
      id: "task-1",
      type: "AGENT_SUBMIT_ORDER",
      status: "COMPLETED",
      scope: "AGENT",
      batchId: "12",
      orderId: "34",
      matchId: null,
      error: null,
      attempts: 1,
      maxAttempts: 3,
      nextRunAt: null,
      heartbeatAt: "2026-05-26T00:00:01.000Z",
      leaseExpiresAt: "2026-05-26T00:02:00.000Z",
      createdAt: "2026-05-26T00:00:00.000Z",
      startedAt: "2026-05-26T00:00:01.000Z",
      completedAt: "2026-05-26T00:00:02.000Z",
      updatedAt: "2026-05-26T00:00:02.000Z",
    });
    expect("payload" in publicRow).toBe(false);
    expect("result" in publicRow).toBe(false);
    expect("trader" in publicRow).toBe(false);
    expect("idempotencyKey" in publicRow).toBe(false);
    expect("leaseOwner" in publicRow).toBe(false);
  });

  it("redacts task event payloads", () => {
    const row: TaskEventRow = {
      id: 5n,
      taskId: "task-1",
      type: "COMPLETED",
      status: "COMPLETED",
      message: "task completed",
      payload: { side: "SELL", size: "1" },
      createdAt: new Date("2026-05-26T00:00:02.000Z"),
    };

    const publicRow = publicTaskEventRow(row);

    expect(publicRow).toEqual({
      id: "5",
      taskId: "task-1",
      type: "COMPLETED",
      status: "COMPLETED",
      message: "task completed",
      createdAt: "2026-05-26T00:00:02.000Z",
    });
    expect("payload" in publicRow).toBe(false);
  });

  it("classifies retryable and stale tasks", () => {
    const now = new Date("2026-05-26T00:05:00.000Z");

    expect(isTaskRetryable({
      status: "FAILED",
      attempts: 1,
      maxAttempts: 3,
      nextRunAt: new Date("2026-05-26T00:04:00.000Z"),
    }, now)).toBe(true);
    expect(isTaskRetryable({
      status: "FAILED",
      attempts: 3,
      maxAttempts: 3,
      nextRunAt: new Date("2026-05-26T00:04:00.000Z"),
    }, now)).toBe(false);
    expect(isTaskStale({
      status: "RUNNING",
      heartbeatAt: new Date("2026-05-26T00:00:00.000Z"),
    }, new Date("2026-05-26T00:01:00.000Z"))).toBe(true);
    expect(isTaskLeaseExpired({
      status: "RUNNING",
      leaseExpiresAt: new Date("2026-05-26T00:04:00.000Z"),
    }, now)).toBe(true);
  });
});
