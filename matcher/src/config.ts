import { z } from "zod";
import "dotenv/config";

const envBool = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

const numericString = z.string().regex(/^\d+(\.\d+)?$/);
const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const optionalEnv = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}, schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ARB_SEPOLIA_RPC_URL: z.string().url(),
  ARB_SEPOLIA_WS_URL: z.string().url(),
  MATCHER_PRIVATE_KEY: optionalEnv(privateKey),
  MATCHER_SECRET_ID: optionalEnv(z.string()),
  RDS_URL: z.string().url(),
  S3_BUCKET: z.string(),
  S3_REGION: z.string().default("ap-south-1"),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  MATCHER_CATCHUP_CHUNK_SIZE: z.coerce.number().int().min(25).max(5_000).default(500),
  MATCHER_CATCHUP_INTERVAL_SEC: z.coerce.number().int().min(0).default(30),
  MATCHER_INDEX_CONFIRMATIONS: z.coerce.number().int().min(0).max(10_000).default(12),
  MATCHER_EMPTY_BATCH_CLOSE_AFTER_SEC: z.coerce.number().int().min(0).default(0),
  MATCHER_BATCH_MATCH_DELAY_SEC: z.coerce.number().int().min(0).max(600).default(15),
  MATCHER_RETRY_WORKER_INTERVAL_SEC: z.coerce.number().int().min(0).default(20),
  MATCHER_TASK_LEASE_SEC: z.coerce.number().int().min(10).max(900).default(120),
  MATCHER_CORS_ORIGINS: optionalEnv(z.string()),
  X402_AGENT_ENABLED: envBool.default(false),
  X402_AGENT_FACILITATOR_URL: z.string().url().default("https://x402.org/facilitator"),
  X402_AGENT_NETWORK: z.string().regex(/^[a-z0-9]+:.+$/).default("eip155:84532"),
  X402_AGENT_PRICE: z.string().min(1).default("$0.01"),
  X402_AGENT_PAY_TO: optionalEnv(evmAddress),
  X402_AGENT_RESOURCE_URL: optionalEnv(z.string().url()),
  X402_AGENT_SYNC_FACILITATOR_ON_START: envBool.default(true),
  AGENT_TRADER_PRIVATE_KEY: optionalEnv(privateKey),
  AGENT_ORDER_DEV_BYPASS_TOKEN: optionalEnv(z.string().min(12)),
  AGENT_ORDER_IDEMPOTENCY_SECRET: optionalEnv(z.string().min(16)),
  AGENT_ORDER_ALLOWED_PAIR_IDS: z.string().regex(/^\d+(,\d+)*$/).default("0,1,2,3"),
  AGENT_ORDER_MAX_NOTIONAL_USDC: numericString.default("10000"),
  AGENT_ORDER_MAX_EXPIRY_HOURS: z.coerce.number().int().min(1).max(720).default(24),
}).superRefine((env, ctx) => {
  if (
    env.NODE_ENV === "production" &&
    (env.X402_AGENT_ENABLED || env.AGENT_ORDER_DEV_BYPASS_TOKEN) &&
    !env.AGENT_ORDER_IDEMPOTENCY_SECRET
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AGENT_ORDER_IDEMPOTENCY_SECRET"],
      message: "AGENT_ORDER_IDEMPOTENCY_SECRET is required in production when agent orders are enabled.",
    });
  }
});

export type Config = z.infer<typeof envSchema> & {
  chainId: number;
  env: "development" | "test" | "production";
};

export async function loadConfig(): Promise<Config> {
  const env = envSchema.parse(process.env);
  return {
    ...env,
    env: env.NODE_ENV,
    chainId: 421614,
  };
}
