import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "../src/config.js";
import { createAgentOrderService } from "../src/agent/orders.js";
import { defaultMakerProfiles, type MakerMode, type MakerProfileInput } from "../src/maker/strategy.js";
import { runMakerBatch } from "../src/maker/runner.js";
import { getDeployment } from "../../shared/addresses/index.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
loadDotenv({ path: path.join(repoRoot, ".env") });

async function main() {
  const args = process.argv.slice(2);
  const execute = hasFlag(args, "--execute");
  const dryRun = hasFlag(args, "--dry-run") || !execute;
  if (execute && hasFlag(args, "--dry-run")) {
    throw new Error("Use either --dry-run or --execute, not both.");
  }

  const mode = parseMode(valueOf(args, "--mode") ?? process.env.MAKER_BOT_MODE ?? "crossing");
  const seed = valueOf(args, "--seed") ?? process.env.MAKER_BOT_SEED ?? `maker-${Date.now()}`;
  const runId = valueOf(args, "--run-id") ?? `maker-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const maxOrdersPerBatch = parsePositiveInt(valueOf(args, "--max-orders") ?? process.env.MAKER_BOT_MAX_ORDERS ?? "8", "max orders");
  const levelsOverride = optionalPositiveInt(valueOf(args, "--levels") ?? process.env.MAKER_BOT_LEVELS, "levels");
  const pairFilter = parsePairFilter(valueOf(args, "--pairs") ?? process.env.MAKER_BOT_PAIRS);

  const profiles = loadProfiles(args, mode)
    .map((profile) => ({ ...profile, mode, ...(levelsOverride ? { levels: levelsOverride } : {}) }))
    .filter((profile) => !pairFilter || pairFilter.has(Number(profile.pairId)));

  if (profiles.length === 0) {
    throw new Error("No maker profiles selected. Check --pairs or profile config.");
  }

  if (execute && !process.env.AGENT_TRADER_PRIVATE_KEY && process.env.DEPLOYER_PRIVATE_KEY) {
    process.env.AGENT_TRADER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
  }

  const dryRunChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.CHAIN_ID ?? 421614);
  let deployment = getDeployment(dryRunChainId);
  let submitter;
  if (execute) {
    const cfg = await loadConfig();
    deployment = getDeployment(cfg.chainId);
    submitter = createAgentOrderService({ cfg, deployment });
  }
  const result = await runMakerBatch({
    deployment,
    profiles,
    seed,
    runId,
    maxOrdersPerBatch,
    dryRun,
    submitter,
  });

  console.log(JSON.stringify({
    ok: result.submissions.every((entry) => entry.ok),
    dryRun: result.dryRun,
    seed: result.plan.seed,
    runId: result.plan.runId,
    mode: result.plan.modeSummary,
    plannedOrders: result.plan.orders.length,
    totalNotionalUSDC: result.plan.totalNotionalUSDC,
    orders: result.plan.orders.map((order) => ({
      clientOrderId: order.clientOrderId,
      pairId: order.pairId,
      pair: order.pairLabel,
      side: order.side,
      size: order.size,
      limitPrice: order.limitPrice,
      notionalUSDC: order.notionalUSDC,
      reason: order.reason,
    })),
    submissions: result.submissions,
  }, null, 2));

  if (result.submissions.some((entry) => !entry.ok)) {
    process.exitCode = 1;
  }
}

function loadProfiles(args: string[], mode: MakerMode): MakerProfileInput[] {
  const filePath = valueOf(args, "--profile-file");
  if (filePath) {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
    if (!Array.isArray(parsed)) throw new Error("--profile-file must contain a JSON array.");
    return parsed as MakerProfileInput[];
  }

  if (process.env.MAKER_BOT_PROFILES_JSON) {
    const parsed = JSON.parse(process.env.MAKER_BOT_PROFILES_JSON);
    if (!Array.isArray(parsed)) throw new Error("MAKER_BOT_PROFILES_JSON must be a JSON array.");
    return parsed as MakerProfileInput[];
  }

  return defaultMakerProfiles(mode);
}

function parseMode(value: string): MakerMode {
  if (value === "crossing" || value === "resting") return value;
  throw new Error(`Invalid maker mode "${value}". Use crossing or resting.`);
}

function parsePairFilter(value?: string) {
  if (!value) return undefined;
  const ids = value.split(",").map((entry) => Number(entry.trim()));
  if (ids.some((id) => !Number.isInteger(id) || id < 0)) {
    throw new Error(`Invalid pair filter "${value}". Use comma-separated non-negative integers.`);
  }
  return new Set(ids);
}

function optionalPositiveInt(value: string | undefined, label: string) {
  if (!value) return undefined;
  return parsePositiveInt(value, label);
}

function parsePositiveInt(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function hasFlag(args: string[], flag: string) {
  return args.includes(flag);
}

function valueOf(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
