import { z } from "zod";
import { buildOrderAmounts, toUnits, type AgentOrderRequest } from "../agent/orders.js";
import type { Deployment } from "../../../shared/addresses/index.js";

const numericString = z.string().trim().regex(/^\d+(\.\d+)?$/);
const sideValues = ["BUY", "SELL"] as const;

export const makerProfileSchema = z.object({
  pairId: z.number().int().nonnegative(),
  enabled: z.boolean().default(true),
  mode: z.enum(["crossing", "resting"]).default("crossing"),
  midPrice: numericString,
  minPrice: numericString.optional(),
  maxPrice: numericString.optional(),
  assetSize: numericString,
  levels: z.number().int().min(1).max(10).default(1),
  spreadBps: z.number().int().min(1).max(5_000).default(80),
  jitterBps: z.number().int().min(0).max(1_000).default(0),
  sizeJitterBps: z.number().int().min(0).max(5_000).default(0),
  maxNotionalPerOrderUSDC: numericString,
  maxNotionalPerBatchUSDC: numericString,
  expiryHours: z.number().int().min(1).max(720).default(1),
});

export type MakerMode = z.infer<typeof makerProfileSchema>["mode"];
export type MakerProfile = z.infer<typeof makerProfileSchema>;
export type MakerProfileInput = z.input<typeof makerProfileSchema>;

export type PlannedMakerOrder = AgentOrderRequest & {
  pairLabel: string;
  baseSymbol: string;
  quoteSymbol: string;
  level: number;
  role: "bid" | "ask";
  notionalUSDC: string;
  reason: string;
};

export type MakerPlan = {
  seed: string;
  runId: string;
  modeSummary: string;
  maxOrdersPerBatch: number;
  totalNotionalUSDC: string;
  orders: PlannedMakerOrder[];
};

export type MakerPlanOptions = {
  deployment: Deployment;
  profiles: MakerProfileInput[];
  seed?: string;
  runId?: string;
  maxOrdersPerBatch?: number;
};

export class MakerPlanError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MakerPlanError";
  }
}

export function defaultMakerProfiles(mode: MakerMode = "crossing"): MakerProfileInput[] {
  return [
    {
      pairId: 0,
      mode,
      midPrice: "3200",
      minPrice: "2800",
      maxPrice: "3800",
      assetSize: "0.005",
      levels: 1,
      spreadBps: 80,
      jitterBps: 12,
      sizeJitterBps: 600,
      maxNotionalPerOrderUSDC: "40",
      maxNotionalPerBatchUSDC: "90",
    },
    {
      pairId: 1,
      mode,
      midPrice: "65500",
      minPrice: "56000",
      maxPrice: "76000",
      assetSize: "0.0003",
      levels: 1,
      spreadBps: 70,
      jitterBps: 10,
      sizeJitterBps: 500,
      maxNotionalPerOrderUSDC: "40",
      maxNotionalPerBatchUSDC: "90",
    },
    {
      pairId: 2,
      mode,
      midPrice: "1.175",
      minPrice: "0.85",
      maxPrice: "1.45",
      assetSize: "20",
      levels: 1,
      spreadBps: 90,
      jitterBps: 15,
      sizeJitterBps: 700,
      maxNotionalPerOrderUSDC: "40",
      maxNotionalPerBatchUSDC: "90",
    },
    {
      pairId: 3,
      mode,
      midPrice: "18.75",
      minPrice: "14",
      maxPrice: "24",
      assetSize: "1.5",
      levels: 1,
      spreadBps: 85,
      jitterBps: 14,
      sizeJitterBps: 700,
      maxNotionalPerOrderUSDC: "40",
      maxNotionalPerBatchUSDC: "90",
    },
  ];
}

export function planMakerBatch(options: MakerPlanOptions): MakerPlan {
  const seed = options.seed ?? "maker-default";
  const runId = options.runId ?? `maker-${Date.now()}`;
  const maxOrdersPerBatch = options.maxOrdersPerBatch ?? 8;
  if (!Number.isInteger(maxOrdersPerBatch) || maxOrdersPerBatch <= 0) {
    throw new MakerPlanError("invalid_max_orders", "maxOrdersPerBatch must be a positive integer.");
  }

  const rng = seededRng(seed);
  const orders: PlannedMakerOrder[] = [];
  let totalNotionalRaw = 0n;
  let totalNotionalDecimals = 6;
  const modes = new Set<MakerMode>();

  for (const input of options.profiles) {
    if (orders.length >= maxOrdersPerBatch) break;

    const profile = makerProfileSchema.parse(input);
    if (!profile.enabled) continue;
    modes.add(profile.mode);

    const pair = options.deployment.pairs.find((entry) => entry.id === profile.pairId);
    if (!pair) {
      throw new MakerPlanError("unknown_pair", `Maker profile references unknown pair ${profile.pairId}.`);
    }

    totalNotionalDecimals = pair.base.decimals;
    const profileBatchLimit = toUnits(profile.maxNotionalPerBatchUSDC, pair.base.decimals);
    let profileNotionalRaw = 0n;

    for (let level = 0; level < profile.levels; level++) {
      for (const side of sideValues) {
        if (orders.length >= maxOrdersPerBatch) break;

        const planned = buildPlannedOrder({
          pair,
          profile,
          level,
          side,
          seed,
          runId,
          rng,
        });
        const amounts = buildOrderAmounts({
          side,
          size: planned.size,
          limitPrice: planned.limitPrice,
          pair,
          maxNotionalUSDC: profile.maxNotionalPerOrderUSDC,
        });

        if (amounts.cashRaw > profileBatchLimit) {
          throw new MakerPlanError(
            "batch_notional_too_small",
            `Pair ${profile.pairId} maxNotionalPerBatchUSDC is smaller than a single planned order.`,
          );
        }
        if (profileNotionalRaw + amounts.cashRaw > profileBatchLimit) break;

        profileNotionalRaw += amounts.cashRaw;
        totalNotionalRaw += amounts.cashRaw;
        orders.push({
          ...planned,
          notionalUSDC: formatDecimal(amounts.cashRaw, pair.base.decimals),
        });
      }
    }
  }

  return {
    seed,
    runId,
    modeSummary: [...modes].sort().join(",") || "none",
    maxOrdersPerBatch,
    totalNotionalUSDC: formatDecimal(totalNotionalRaw, totalNotionalDecimals),
    orders,
  };
}

function buildPlannedOrder(args: {
  pair: Deployment["pairs"][number];
  profile: MakerProfile;
  level: number;
  side: AgentOrderRequest["side"];
  seed: string;
  runId: string;
  rng: () => number;
}): Omit<PlannedMakerOrder, "notionalUSDC"> {
  const priceRaw = planPriceRaw(args);
  const sizeRaw = planSizeRaw(args);
  const limitPrice = formatDecimal(priceRaw, args.pair.base.decimals);
  const size = formatDecimal(sizeRaw, args.pair.quote.decimals);
  const role = args.side === "BUY" ? "bid" : "ask";

  assertPriceBand({
    priceRaw,
    profile: args.profile,
    priceDecimals: args.pair.base.decimals,
    pairLabel: pairLabel(args.pair),
  });

  return {
    pairId: args.pair.id,
    side: args.side,
    size,
    limitPrice,
    expiryHours: args.profile.expiryHours,
    clientOrderId: `${args.runId}-p${args.pair.id}-l${args.level + 1}-${role}`,
    agent: "obsidian-maker-bot",
    pairLabel: pairLabel(args.pair),
    baseSymbol: cleanSymbol(args.pair.base.symbol),
    quoteSymbol: cleanSymbol(args.pair.quote.symbol),
    level: args.level + 1,
    role,
    reason: `${args.profile.mode} ${role} level ${args.level + 1} seed ${args.seed}`,
  };
}

function planPriceRaw(args: {
  pair: Deployment["pairs"][number];
  profile: MakerProfile;
  level: number;
  side: AgentOrderRequest["side"];
  rng: () => number;
}) {
  const midRaw = toUnits(args.profile.midPrice, args.pair.base.decimals);
  const levelSpread = args.profile.spreadBps * (args.level + 1);
  const halfSpread = Math.max(1, Math.floor(levelSpread / 2));
  const jitter = randomBps(args.rng, args.profile.jitterBps);
  const direction = args.profile.mode === "crossing"
    ? (args.side === "BUY" ? 1 : -1)
    : (args.side === "BUY" ? -1 : 1);
  return applyBps(midRaw, direction * halfSpread + jitter);
}

function planSizeRaw(args: {
  pair: Deployment["pairs"][number];
  profile: MakerProfile;
  rng: () => number;
}) {
  const baseSize = toUnits(args.profile.assetSize, args.pair.quote.decimals);
  return applyBps(baseSize, randomBps(args.rng, args.profile.sizeJitterBps));
}

function assertPriceBand(args: {
  priceRaw: bigint;
  profile: MakerProfile;
  priceDecimals: number;
  pairLabel: string;
}) {
  if (args.profile.minPrice) {
    const minRaw = toUnits(args.profile.minPrice, args.priceDecimals);
    if (args.priceRaw < minRaw) {
      throw new MakerPlanError(
        "price_below_band",
        `${args.pairLabel} planned price ${formatDecimal(args.priceRaw, args.priceDecimals)} is below ${args.profile.minPrice}.`,
      );
    }
  }
  if (args.profile.maxPrice) {
    const maxRaw = toUnits(args.profile.maxPrice, args.priceDecimals);
    if (args.priceRaw > maxRaw) {
      throw new MakerPlanError(
        "price_above_band",
        `${args.pairLabel} planned price ${formatDecimal(args.priceRaw, args.priceDecimals)} is above ${args.profile.maxPrice}.`,
      );
    }
  }
}

function applyBps(raw: bigint, bpsDelta: number) {
  const factor = 10_000 + bpsDelta;
  if (factor <= 0) {
    throw new MakerPlanError("invalid_bps_delta", `Bps delta ${bpsDelta} makes a non-positive value.`);
  }
  return (raw * BigInt(factor)) / 10_000n;
}

function randomBps(rng: () => number, maxAbsBps: number) {
  if (maxAbsBps === 0) return 0;
  return Math.floor(rng() * (maxAbsBps * 2 + 1)) - maxAbsBps;
}

function formatDecimal(raw: bigint, decimals: number) {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = raw % scale;
  if (fraction === 0n) return whole.toString();
  const trimmed = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${trimmed}`;
}

function pairLabel(pair: Deployment["pairs"][number]) {
  return `${cleanSymbol(pair.quote.symbol)} / ${cleanSymbol(pair.base.symbol)}`;
}

function cleanSymbol(symbol: string) {
  return symbol.replace(/^e/, "");
}

function seededRng(seed: string) {
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 0x01000193);
  }
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
