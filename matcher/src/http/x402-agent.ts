import type { RequestHandler } from "express";
import { HTTPFacilitatorClient, type RoutesConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import type { Config } from "../config.js";

export function createAgentX402Middleware(cfg: Config): RequestHandler | undefined {
  if (!cfg.X402_AGENT_ENABLED) return undefined;
  if (!cfg.X402_AGENT_PAY_TO) {
    throw new Error("X402_AGENT_PAY_TO is required when X402_AGENT_ENABLED=true");
  }

  const network = cfg.X402_AGENT_NETWORK as Network;
  const facilitatorClient = new HTTPFacilitatorClient({
    url: cfg.X402_AGENT_FACILITATOR_URL,
  });
  const server = new x402ResourceServer(facilitatorClient)
    .register(network, new ExactEvmScheme());

  const routes: RoutesConfig = {
    "POST /agent/orders": {
      accepts: [
        {
          scheme: "exact",
          network,
          price: cfg.X402_AGENT_PRICE,
          payTo: cfg.X402_AGENT_PAY_TO,
          maxTimeoutSeconds: 120,
          extra: {
            product: "obsidian-darkpool-agent-order",
          },
        },
      ],
      resource: cfg.X402_AGENT_RESOURCE_URL,
      description: "Submit an encrypted Obsidian dark-pool order for an autonomous agent.",
      mimeType: "application/json",
      unpaidResponseBody: () => ({
        contentType: "application/json",
        body: {
          error: "x402 payment required",
          endpoint: "POST /agent/orders",
        },
      }),
      settlementFailedResponseBody: () => ({
        contentType: "application/json",
        body: {
          error: "x402 settlement failed",
        },
      }),
    },
  };

  return paymentMiddleware(
    routes,
    server,
    undefined,
    undefined,
    cfg.X402_AGENT_SYNC_FACILITATOR_ON_START,
  );
}
