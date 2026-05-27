import { once } from "node:events";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../src/config.js";
import { createAgentOrderService } from "../src/agent/orders.js";
import { startHttp } from "../src/http/server.js";
import { createAgentX402Middleware } from "../src/http/x402-agent.js";
import { getDeployment } from "../../shared/addresses/index.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
loadDotenv({ path: path.join(repoRoot, ".env") });

const fallbackKey = process.env.AGENT_TRADER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
if (!process.env.X402_AGENT_PAY_TO && !fallbackKey) {
  throw new Error("Set X402_AGENT_PAY_TO or DEPLOYER_PRIVATE_KEY to run the x402 challenge E2E.");
}

if (!process.env.X402_AGENT_PAY_TO && fallbackKey) {
  process.env.X402_AGENT_PAY_TO = privateKeyToAccount(fallbackKey as `0x${string}`).address;
}
if (fallbackKey) process.env.AGENT_TRADER_PRIVATE_KEY = fallbackKey;
process.env.X402_AGENT_ENABLED = "true";
process.env.X402_AGENT_NETWORK ||= "eip155:84532";
process.env.X402_AGENT_FACILITATOR_URL ||= "https://x402.org/facilitator";
process.env.X402_AGENT_PRICE ||= "$0.01";
process.env.AGENT_ORDER_MAX_NOTIONAL_USDC ||= "10";
process.env.AGENT_ORDER_MAX_EXPIRY_HOURS ||= "1";

async function main() {
  const cfg = await loadConfig();
  const deployment = getDeployment(cfg.chainId);
  const orderService = createAgentOrderService({ cfg, deployment });

  const server = startHttp(0, {} as any, cfg.X402_AGENT_PAY_TO!, async () => {}, {
    orderService,
    paymentMiddleware: createAgentX402Middleware(cfg),
    x402Enabled: true,
  });
  if (!server.listening) await once(server, "listening");

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/agent/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pairId: 0,
        side: "BUY",
        size: "0.000001",
        limitPrice: "1",
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status !== 402) {
      throw new Error(`expected x402 challenge HTTP 402, got ${response.status}: ${JSON.stringify(body)}`);
    }

    console.log(JSON.stringify({
      ok: true,
      status: response.status,
      x402Network: cfg.X402_AGENT_NETWORK,
      facilitatorUrl: cfg.X402_AGENT_FACILITATOR_URL,
      payToConfigured: Boolean(cfg.X402_AGENT_PAY_TO),
      paymentHeaderPresent: Boolean(response.headers.get("payment-required")),
      body,
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
