# Alpha 80 Spec: Maker Bot Runner

## Purpose

Create honest, bounded demo liquidity so Obsidian has repeated settled matches and real candle history without pretending to expose a live order book.

## Current Implementation

The first maker-bot slice is a guarded CLI runner:

```powershell
npm --prefix matcher run maker:dry-run
npm --prefix matcher run maker:execute
```

Default behavior is dry-run. Live submission requires the explicit `maker:execute` script, which routes planned orders through the existing agent order service and CoFHE encrypted `submitOrder` path.

## Files

- `matcher/src/maker/strategy.ts`
- `matcher/src/maker/runner.ts`
- `matcher/scripts/maker-bot.ts`
- `matcher/src/maker/strategy.test.ts`
- `matcher/src/maker/runner.test.ts`

## Profiles

Default profiles cover:

- Pair `0`: WETH / USDC
- Pair `1`: WBTC / USDC
- Pair `2`: ARB / USDC
- Pair `3`: LINK / USDC

Each profile defines:

- Pair id.
- Mode: `crossing` or `resting`.
- Mid price.
- Min and max price band.
- Asset size.
- Spread in bps.
- Optional price and size jitter.
- Max notional per order.
- Max notional per batch.
- Expiry hours.

## Modes

`crossing`:

- BUY price is above mid.
- SELL price is below mid.
- Intended to generate matched demo liquidity after batch close.

`resting`:

- BUY price is below mid.
- SELL price is above mid.
- Intended to create non-crossing liquidity experiments without forced matches.

## Safeguards

- Dry-run does not require DB, S3, private keys, or a live matcher.
- Live mode requires `AGENT_TRADER_PRIVATE_KEY` or falls back to `DEPLOYER_PRIVATE_KEY`.
- Unknown pair ids fail before submission.
- Prices outside configured bands fail before submission.
- Per-order notional caps are enforced through the same amount builder as the agent order API.
- Per-profile batch notional caps prevent oversized batches.
- `--max-orders` caps the total number of planned orders.
- CLI output never prints private keys.

## Useful Commands

Fixed-seed smoke dry-run:

```powershell
npm --prefix matcher run maker:dry-run -- --seed codex-smoke --run-id codex-smoke --max-orders 8
```

Single-pair dry-run:

```powershell
npm --prefix matcher run maker:dry-run -- --pairs 2 --seed arb-only --max-orders 2
```

Resting-mode dry-run:

```powershell
npm --prefix matcher run maker:dry-run -- --mode resting --pairs 0,1 --max-orders 4
```

Live guarded submit:

```powershell
npm --prefix matcher run maker:execute -- --seed live-001 --run-id live-001 --max-orders 8
```

For live maker tests, use a wider batch duration before submitting multiple encrypted orders:

```powershell
$env:DEMO_BATCH_DURATION_SEC="240"
pnpm demo:market:configure
```

## Acceptance

- Unit tests cover deterministic planning, crossing/resting price behavior, unknown pairs, price bands, dry-run behavior, and sanitized live submission requests.
- Dry-run produces planned orders without submitting transactions.
- Live mode is explicit and sequential; failed submissions are captured per order.
- The matcher daemon remains responsible for batch close, match publish, audit logging, and settlement.

## Ops Recovery

If a batch closes before the catchup loop indexes all orders, dry-run matching can be checked after catchup and then replayed through the same matcher publish path:

```powershell
npm --prefix matcher run ops:match-batch -- 75 --dry-run
npm --prefix matcher run ops:match-batch -- 75
```

This script still enforces the on-chain matcher wallet check and uses `onBatchClosed`, so existing match rows are not duplicated.

## First Live Proof

On 2026-05-25 IST, the guarded maker flow produced batch `75` ARB match `29`:

- BUY order `76`, SELL order `75`.
- Clearing price `1.17458847`.
- Publish tx `0x45e23c8cbec0b0b50ea841b6caaea899e0d6c1f103d11a335e925ed9ec9cdfb6`.
- Settle tx `0x588322ebddc342e3f29f310b238147377d161b19a0e8b4a3048eaf909cd151df`.
- Audit key `pair-2/batch-75/match-29.json`.
