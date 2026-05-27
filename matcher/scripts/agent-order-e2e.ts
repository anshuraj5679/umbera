import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../src/config.js";
import { createAgentOrderService } from "../src/agent/orders.js";
import { startHttp } from "../src/http/server.js";
import { getDeployment } from "../../shared/addresses/index.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
loadDotenv({ path: path.join(repoRoot, ".env") });

const fallbackTraderKey = process.env.AGENT_TRADER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
if (!fallbackTraderKey) {
  throw new Error("Set AGENT_TRADER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY to run the agent order E2E.");
}

process.env.AGENT_TRADER_PRIVATE_KEY = fallbackTraderKey;
process.env.X402_AGENT_ENABLED = "false";
process.env.AGENT_ORDER_DEV_BYPASS_TOKEN ||= `local-e2e-${randomBytes(16).toString("hex")}`;
process.env.AGENT_ORDER_MAX_NOTIONAL_USDC ||= "10";
process.env.AGENT_ORDER_MAX_EXPIRY_HOURS ||= "1";

const requestBody = {
  pairId: Number(process.env.AGENT_E2E_PAIR_ID ?? "0"),
  side: (process.env.AGENT_E2E_SIDE ?? "BUY").toUpperCase(),
  size: process.env.AGENT_E2E_SIZE ?? "0.000001",
  limitPrice: process.env.AGENT_E2E_LIMIT_PRICE ?? "1",
  expiryHours: 1,
  clientOrderId: `local-e2e-${Date.now()}`,
  agent: "local-e2e",
};

async function main() {
  const cfg = await loadConfig();
  const deployment = getDeployment(cfg.chainId);
  const orderService = createAgentOrderService({ cfg, deployment });
  const trader = privateKeyToAccount(fallbackTraderKey as `0x${string}`).address;

  const server = startHttp(0, {} as any, trader, async () => {}, {
    orderService,
    x402Enabled: false,
    devBypassToken: cfg.AGENT_ORDER_DEV_BYPASS_TOKEN,
  });
  if (!server.listening) await once(server, "listening");

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const capabilities = await fetch(`${baseUrl}/agent/capabilities`).then((res) => res.json());
    if (!capabilities?.ok || !capabilities.traderConfigured) {
      throw new Error(`agent capabilities invalid: ${JSON.stringify(capabilities)}`);
    }

    const response = await fetch(`${baseUrl}/agent/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-bypass-token": cfg.AGENT_ORDER_DEV_BYPASS_TOKEN!,
      },
      body: JSON.stringify(requestBody),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`agent order E2E failed: HTTP ${response.status} ${JSON.stringify(body)}`);
    }

    console.log(JSON.stringify({
      ok: true,
      txHash: body.txHash,
      orderId: body.orderId,
      batchId: body.batchId,
      pairId: body.pairId,
      paymentMode: body.paymentMode,
    }, null, 2));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
