import { z } from "zod";
import type { Deployment } from "../../../shared/addresses/index.js";
import type { Config } from "../config.js";

const decimalString = z.string().trim().regex(/^\d+(\.\d+)?$/);

export const agentOrderRequestSchema = z.object({
  pairId: z.coerce.number().int().nonnegative(),
  side: z.enum(["BUY", "SELL"]),
  size: decimalString,
  limitPrice: decimalString,
  expiryHours: z.coerce.number().int().min(1).optional(),
  clientOrderId: z.string().trim().min(1).max(80).optional(),
  agent: z.string().trim().min(1).max(120).optional(),
  sessionAccountCommitment: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
}).strict();

export type AgentOrderRequest = z.infer<typeof agentOrderRequestSchema>;

export type AgentOrderResult = {
  ok: true;
  txHash: string;
  orderId: string;
  batchId: string;
  pairId: number;
  expiry: string;
  accountCommitment?: string;
};

export class AgentOrderError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AgentOrderError";
  }
}

type AgentOrderServiceOptions = {
  cfg: Config;
  deployment: Deployment;
};

export function createAgentOrderService({ cfg, deployment }: AgentOrderServiceOptions) {
  const allowedPairIds = new Set(cfg.AGENT_ORDER_ALLOWED_PAIR_IDS.split(",").map((entry) => Number(entry)));

  return {
    capabilities() {
      return {
        ok: true,
        network: "midnight-preprod",
        x402: {
          enabled: cfg.X402_AGENT_ENABLED,
          facilitatorUrl: cfg.X402_AGENT_FACILITATOR_URL,
          network: cfg.X402_AGENT_NETWORK,
          price: cfg.X402_AGENT_PRICE,
          payToConfigured: Boolean(cfg.X402_AGENT_PAY_TO),
          resourceUrl: cfg.X402_AGENT_RESOURCE_URL,
        },
        devBypassEnabled: Boolean(cfg.AGENT_ORDER_DEV_BYPASS_TOKEN),
        traderConfigured: true,
        limits: {
          allowedPairIds: [...allowedPairIds],
          maxNotionalUSDC: cfg.AGENT_ORDER_MAX_NOTIONAL_USDC,
          maxExpiryHours: cfg.AGENT_ORDER_MAX_EXPIRY_HOURS,
        },
        pairs: deployment.pairs.map((pair) => ({
          id: pair.id,
          base: pair.base,
          quote: pair.quote,
          supportedSides: ["BUY", "SELL"],
        })),
        orderRequest: {
          method: "POST",
          path: "/agent/orders",
          authorization: "Bearer access token from POST /agent/access",
          body: {
            pairId: "number",
            side: "BUY | SELL",
            size: "asset amount as decimal string",
            limitPrice: "USDC per asset as decimal string",
            expiryHours: "optional integer",
            clientOrderId: "optional string",
            agent: "optional string",
            sessionAccountCommitment: "required bytes32 account commitment",
          },
        },
      };
    },

    async submit(input: unknown): Promise<AgentOrderResult> {
      const parsed = agentOrderRequestSchema.safeParse(input);
      if (!parsed.success) {
        throw new AgentOrderError(400, "invalid_order_request", "Invalid agent order request.", parsed.error.flatten());
      }

      const request = parsed.data;
      const pair = deployment.pairs.find((entry) => entry.id === request.pairId);
      if (!pair || !allowedPairIds.has(request.pairId)) {
        throw new AgentOrderError(400, "pair_not_allowed", `Pair ${request.pairId} is not enabled for agent orders.`);
      }

      const simulatedTx = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
      const expiry = BigInt(Math.floor(Date.now() / 1000) + (request.expiryHours ?? cfg.AGENT_ORDER_MAX_EXPIRY_HOURS) * 3600);

      return {
        ok: true,
        txHash: simulatedTx,
        orderId: "1",
        batchId: "1",
        pairId: pair.id,
        expiry: expiry.toString(),
        accountCommitment: request.sessionAccountCommitment,
      };
    },
  };
}

export type AgentOrderService = ReturnType<typeof createAgentOrderService>;
