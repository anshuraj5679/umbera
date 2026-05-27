import { z } from "zod";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import dexArtifact from "../../../shared/abi/DarkPoolDEX.json" with { type: "json" };
import wrapperArtifact from "../../../shared/abi/FHERC20Wrapper.json" with { type: "json" };
import type { Deployment } from "../../../shared/addresses/index.js";
import type { Config } from "../config.js";

const dexAbi = (dexArtifact as { abi: unknown[] }).abi;
const wrapperAbi = (wrapperArtifact as { abi: unknown[] }).abi;
const UINT128_MAX = (1n << 128n) - 1n;
const MIN_PRIORITY_FEE = 100_000n;

const decimalString = z.string().trim().regex(/^\d+(\.\d+)?$/);

export const agentOrderRequestSchema = z.object({
  pairId: z.coerce.number().int().nonnegative(),
  side: z.enum(["BUY", "SELL"]),
  size: decimalString,
  limitPrice: decimalString,
  expiryHours: z.coerce.number().int().min(1).optional(),
  clientOrderId: z.string().trim().min(1).max(80).optional(),
  agent: z.string().trim().min(1).max(120).optional(),
  sessionAccountCommitment: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
}).strict();

export type AgentOrderRequest = z.infer<typeof agentOrderRequestSchema>;

export type AgentOrderResult = {
  ok: true;
  txHash: Hex;
  orderId: string;
  batchId: string;
  pairId: number;
  expiry: string;
  accountCommitment?: Hex;
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

type CofheRuntime = {
  cofhe: {
    encryptInputs(inputs: unknown[]): { execute(): Promise<unknown[]> };
  };
  Encryptable: {
    uint128(value: bigint): unknown;
  };
};

export function createAgentOrderService({ cfg, deployment }: AgentOrderServiceOptions) {
  const allowedPairIds = parsePairIds(cfg.AGENT_ORDER_ALLOWED_PAIR_IDS);
  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(cfg.ARB_SEPOLIA_RPC_URL),
  });

  const account = cfg.AGENT_TRADER_PRIVATE_KEY
    ? privateKeyToAccount(cfg.AGENT_TRADER_PRIVATE_KEY as Hex)
    : undefined;
  const walletClient = account
    ? createWalletClient({ chain: arbitrumSepolia, transport: http(cfg.ARB_SEPOLIA_RPC_URL), account })
    : undefined;
  let cofhePromise: Promise<CofheRuntime> | undefined;

  async function cofheRuntime(): Promise<CofheRuntime> {
    if (!account || !walletClient) {
      throw new AgentOrderError(
        503,
        "agent_trader_not_configured",
        "AGENT_TRADER_PRIVATE_KEY is required before the agent order API can submit DEX orders.",
      );
    }
    cofhePromise ??= initAgentCofhe(publicClient, walletClient, account.address);
    return cofhePromise;
  }

  return {
    capabilities() {
      return {
        ok: true,
        dexChain: { chainId: deployment.chainId, network: "arbitrum-sepolia", dex: deployment.dex },
        x402: {
          enabled: cfg.X402_AGENT_ENABLED,
          facilitatorUrl: cfg.X402_AGENT_FACILITATOR_URL,
          network: cfg.X402_AGENT_NETWORK,
          price: cfg.X402_AGENT_PRICE,
          payToConfigured: Boolean(cfg.X402_AGENT_PAY_TO),
          resourceUrl: cfg.X402_AGENT_RESOURCE_URL,
        },
        devBypassEnabled: Boolean(cfg.AGENT_ORDER_DEV_BYPASS_TOKEN),
        traderConfigured: Boolean(account),
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
          body: {
            pairId: "number",
            side: "BUY | SELL",
            size: "asset amount as decimal string",
            limitPrice: "USDC per asset as decimal string",
            expiryHours: "optional integer",
            clientOrderId: "optional string",
            agent: "optional string",
            sessionAccountCommitment: "optional bytes32 account commitment",
          },
        },
      };
    },

    async submit(input: unknown): Promise<AgentOrderResult> {
      if (!account || !walletClient) {
        throw new AgentOrderError(
          503,
          "agent_trader_not_configured",
          "AGENT_TRADER_PRIVATE_KEY is required before the agent order API can submit DEX orders.",
        );
      }

      const parsed = agentOrderRequestSchema.safeParse(input);
      if (!parsed.success) {
        throw new AgentOrderError(400, "invalid_order_request", "Invalid agent order request.", parsed.error.flatten());
      }

      const request = parsed.data;
      const pair = deployment.pairs.find((entry) => entry.id === request.pairId);
      if (!pair || !allowedPairIds.has(request.pairId)) {
        throw new AgentOrderError(400, "pair_not_allowed", `Pair ${request.pairId} is not enabled for agent orders.`);
      }
      if ((request.expiryHours ?? cfg.AGENT_ORDER_MAX_EXPIRY_HOURS) > cfg.AGENT_ORDER_MAX_EXPIRY_HOURS) {
        throw new AgentOrderError(
          400,
          "expiry_too_large",
          `expiryHours must be <= ${cfg.AGENT_ORDER_MAX_EXPIRY_HOURS}.`,
        );
      }

      const amounts = buildOrderAmounts({
        side: request.side,
        size: request.size,
        limitPrice: request.limitPrice,
        pair,
        maxNotionalUSDC: cfg.AGENT_ORDER_MAX_NOTIONAL_USDC,
      });

      const expiry = BigInt(Math.floor(Date.now() / 1000) + (request.expiryHours ?? cfg.AGENT_ORDER_MAX_EXPIRY_HOURS) * 3600);
      await ensureOperator(publicClient, walletClient, account, deployment.dex, pair.base.address as Address);
      await ensureOperator(publicClient, walletClient, account, deployment.dex, pair.quote.address as Address);

      const runtime = await cofheRuntime();
      const accountCommitment = request.sessionAccountCommitment?.toLowerCase() as Hex | undefined;
      if (accountCommitment) {
        await ensureSessionAuthorized(publicClient, walletClient, account, deployment.dex, accountCommitment);
      }
      const encrypted = await runtime.cofhe.encryptInputs([
        runtime.Encryptable.uint128(amounts.baseDepositRaw),
        runtime.Encryptable.uint128(amounts.quoteDepositRaw),
        runtime.Encryptable.uint128(amounts.baseRequestRaw),
        runtime.Encryptable.uint128(amounts.quoteRequestRaw),
      ]).execute();
      if (encrypted.length !== 4) {
        throw new AgentOrderError(502, "encryption_failed", "CoFHE encryption returned an unexpected payload.");
      }
      const [encBaseDeposit, encQuoteDeposit, encBaseRequest, encQuoteRequest] = encrypted;

      const hash = await walletClient.writeContract({
        account,
        chain: arbitrumSepolia,
        address: deployment.dex,
        abi: dexAbi,
        functionName: accountCommitment ? "submitOrderForAccount" : "submitOrder",
        args: accountCommitment
          ? [
            accountCommitment,
            BigInt(pair.id),
            encBaseDeposit,
            encQuoteDeposit,
            encBaseRequest,
            encQuoteRequest,
            expiry,
          ]
          : [
            BigInt(pair.id),
            encBaseDeposit,
            encQuoteDeposit,
            encBaseRequest,
            encQuoteRequest,
            expiry,
          ],
        gas: 6_000_000n,
        ...(await txFees(publicClient)),
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new AgentOrderError(502, "order_tx_reverted", `submitOrder reverted: ${hash}`, { txHash: hash });
      }

      const submitted = parseOrderSubmitted(receipt, deployment.dex);
      if (!submitted) {
        throw new AgentOrderError(502, "order_event_missing", `OrderSubmitted event missing in receipt: ${hash}`, { txHash: hash });
      }

      return {
        ok: true,
        txHash: hash,
        orderId: submitted.orderId.toString(),
        batchId: submitted.batchId.toString(),
        pairId: pair.id,
        expiry: expiry.toString(),
        ...(submitted.accountCommitment ? { accountCommitment: submitted.accountCommitment } : {}),
      };
    },
  };
}

export type AgentOrderService = ReturnType<typeof createAgentOrderService>;

type Pair = Deployment["pairs"][number];

export function buildOrderAmounts(args: {
  side: AgentOrderRequest["side"];
  size: string;
  limitPrice: string;
  pair: Pair;
  maxNotionalUSDC: string;
}) {
  const assetRaw = toUnits(args.size, args.pair.quote.decimals);
  const priceRaw = toUnits(args.limitPrice, args.pair.base.decimals);
  if (assetRaw <= 0n) throw new AgentOrderError(400, "invalid_size", "size must be greater than zero.");
  if (priceRaw <= 0n) throw new AgentOrderError(400, "invalid_limit_price", "limitPrice must be greater than zero.");

  const cashRaw = (assetRaw * priceRaw) / 10n ** BigInt(args.pair.quote.decimals);
  if (cashRaw <= 0n) {
    throw new AgentOrderError(400, "notional_too_small", "Order notional rounds to zero at token precision.");
  }

  const maxNotionalRaw = toUnits(args.maxNotionalUSDC, args.pair.base.decimals);
  if (cashRaw > maxNotionalRaw) {
    throw new AgentOrderError(400, "notional_too_large", `Order notional exceeds ${args.maxNotionalUSDC} USDC.`);
  }

  const baseDepositRaw = args.side === "BUY" ? cashRaw : 0n;
  const quoteDepositRaw = args.side === "SELL" ? assetRaw : 0n;
  const baseRequestRaw = args.side === "SELL" ? cashRaw : 0n;
  const quoteRequestRaw = args.side === "BUY" ? assetRaw : 0n;
  const depositRaw = args.side === "BUY" ? baseDepositRaw : quoteDepositRaw;
  const requestRaw = args.side === "BUY" ? quoteRequestRaw : baseRequestRaw;
  assertUint128(baseDepositRaw, "base deposit amount");
  assertUint128(quoteDepositRaw, "quote deposit amount");
  assertUint128(baseRequestRaw, "base request amount");
  assertUint128(quoteRequestRaw, "quote request amount");

  return {
    assetRaw,
    priceRaw,
    cashRaw,
    baseDepositRaw,
    quoteDepositRaw,
    baseRequestRaw,
    quoteRequestRaw,
    depositRaw,
    requestRaw,
    escrowToken: (args.side === "BUY" ? args.pair.base.address : args.pair.quote.address) as Address,
    depositToken: args.side === "BUY" ? args.pair.base.symbol : args.pair.quote.symbol,
    requestToken: args.side === "BUY" ? args.pair.quote.symbol : args.pair.base.symbol,
  };
}

export function toUnits(value: string, decimals: number) {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new AgentOrderError(400, "invalid_decimal", `Invalid numeric value: ${value}`);
  }
  const parts = value.split(".");
  const whole = parts[0] ?? "0";
  const fraction = parts[1] ?? "";
  if (fraction.length > decimals) {
    throw new AgentOrderError(400, "too_many_decimals", `Value ${value} exceeds ${decimals} decimal places.`);
  }
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

async function initAgentCofhe(publicClient: PublicClient, walletClient: unknown, address: Address): Promise<CofheRuntime> {
  installMemoryLocalStorage();
  const [nodeSdk, sdk, chains] = await Promise.all([
    import("@cofhe/sdk/node"),
    import("@cofhe/sdk"),
    import("@cofhe/sdk/chains"),
  ]);
  const cofhe = nodeSdk.createCofheClient(nodeSdk.createCofheConfig({ supportedChains: [chains.arbSepolia] }));
  await cofhe.connect(publicClient as any, walletClient as any);
  await cofhe.permits.getOrCreateSelfPermit(arbitrumSepolia.id, address, {
    issuer: address,
    name: "Obsidian Agent Trader",
  });
  return { cofhe: cofhe as CofheRuntime["cofhe"], Encryptable: sdk.Encryptable as CofheRuntime["Encryptable"] };
}

async function ensureOperator(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: Account,
  dex: Address,
  wrapper: Address,
) {
  const active = await publicClient.readContract({
    address: wrapper,
    abi: wrapperAbi,
    functionName: "isOperator",
    args: [account.address, dex],
  });
  if (active) return;

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
  const hash = await walletClient.writeContract({
    account,
    chain: arbitrumSepolia,
    address: wrapper,
    abi: wrapperAbi,
    functionName: "setOperator",
    args: [dex, deadline],
    gas: 250_000n,
    ...(await txFees(publicClient)),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new AgentOrderError(502, "operator_tx_reverted", `setOperator reverted: ${hash}`, { txHash: hash });
  }
}

async function ensureSessionAuthorized(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: Account,
  dex: Address,
  accountCommitment: Hex,
) {
  const active = await publicClient.readContract({
    address: dex,
    abi: dexAbi,
    functionName: "sessionAuthorized",
    args: [accountCommitment, account.address],
  });
  if (active) return;

  const hash = await walletClient.writeContract({
    account,
    chain: arbitrumSepolia,
    address: dex,
    abi: dexAbi,
    functionName: "registerSessionAccount",
    args: [accountCommitment],
    gas: 250_000n,
    ...(await txFees(publicClient)),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new AgentOrderError(502, "session_account_tx_reverted", `registerSessionAccount reverted: ${hash}`, { txHash: hash });
  }
}

function parseOrderSubmitted(receipt: TransactionReceipt, dex: Address) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== dex.toLowerCase()) continue;
    try {
      const parsed = decodeEventLog({
        abi: dexAbi,
        data: log.data,
        topics: log.topics,
      });
      if (parsed.eventName !== "OrderSubmitted" && parsed.eventName !== "OrderSubmittedPrivate") continue;
      const args = parsed.args as unknown as {
        orderId: bigint;
        pairId: bigint;
        batchId: bigint;
        trader: Address;
        accountCommitment?: Hex;
      };
      return args;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function txFees(publicClient: PublicClient) {
  try {
    const [block, estimate] = await Promise.all([
      publicClient.getBlock({ blockTag: "latest" }),
      publicClient.estimateFeesPerGas().catch(() => null),
    ]);
    const baseFee = block.baseFeePerGas ?? 0n;
    const estimatedMax = estimate?.maxFeePerGas ?? 0n;
    const priority = maxBigint(estimate?.maxPriorityFeePerGas ?? 0n, MIN_PRIORITY_FEE);
    return {
      maxFeePerGas: maxBigint(baseFee + baseFee / 2n + priority, estimatedMax + estimatedMax / 2n),
      maxPriorityFeePerGas: priority,
    };
  } catch {
    return {};
  }
}

function parsePairIds(value: string) {
  return new Set(value.split(",").map((entry) => Number(entry)));
}

function assertUint128(value: bigint, label: string) {
  if (value > UINT128_MAX) {
    throw new AgentOrderError(400, "amount_too_large", `${label} exceeds uint128.`);
  }
}

function maxBigint(...values: bigint[]) {
  return values.reduce((max, value) => (value > max ? value : max), 0n);
}

function installMemoryLocalStorage() {
  const existing = globalThis.localStorage;
  if (
    existing &&
    typeof existing.getItem === "function" &&
    typeof existing.setItem === "function" &&
    typeof existing.removeItem === "function"
  ) return;
  const data = new Map<string, string>();
  globalThis.localStorage = {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}
