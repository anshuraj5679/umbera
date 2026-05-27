import type { AgentOrderRequest, AgentOrderResult } from "../agent/orders.js";
import { planMakerBatch, type MakerPlan, type MakerPlanOptions, type PlannedMakerOrder } from "./strategy.js";

export type MakerSubmitter = {
  submit(input: AgentOrderRequest): Promise<AgentOrderResult>;
};

export type MakerSubmission =
  | {
      ok: true;
      clientOrderId?: string;
      pairId: number;
      side: AgentOrderRequest["side"];
      txHash: AgentOrderResult["txHash"];
      orderId: string;
      batchId: string;
    }
  | {
      ok: false;
      clientOrderId?: string;
      pairId: number;
      side: AgentOrderRequest["side"];
      error: string;
      code?: string;
    };

export type MakerRunResult = {
  dryRun: boolean;
  plan: MakerPlan;
  submissions: MakerSubmission[];
};

export type MakerRunOptions = MakerPlanOptions & {
  dryRun?: boolean;
  submitter?: MakerSubmitter;
  stopOnError?: boolean;
};

export async function runMakerBatch(options: MakerRunOptions): Promise<MakerRunResult> {
  const plan = planMakerBatch(options);
  if (options.dryRun ?? true) {
    return { dryRun: true, plan, submissions: [] };
  }
  if (!options.submitter) {
    throw new Error("submitter is required when dryRun is false.");
  }

  const submissions: MakerSubmission[] = [];
  for (const order of plan.orders) {
    try {
      const result = await options.submitter.submit(toAgentOrderRequest(order));
      submissions.push({
        ok: true,
        clientOrderId: order.clientOrderId,
        pairId: order.pairId,
        side: order.side,
        txHash: result.txHash,
        orderId: result.orderId,
        batchId: result.batchId,
      });
    } catch (error) {
      const failed = {
        ok: false as const,
        clientOrderId: order.clientOrderId,
        pairId: order.pairId,
        side: order.side,
        error: error instanceof Error ? error.message : String(error),
        code: errorCode(error),
      };
      submissions.push(failed);
      if (options.stopOnError) break;
    }
  }

  return { dryRun: false, plan, submissions };
}

export function toAgentOrderRequest(order: PlannedMakerOrder): AgentOrderRequest {
  return {
    pairId: order.pairId,
    side: order.side,
    size: order.size,
    limitPrice: order.limitPrice,
    expiryHours: order.expiryHours,
    clientOrderId: order.clientOrderId,
    agent: order.agent,
  };
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown };
  return typeof candidate.code === "string" ? candidate.code : undefined;
}
