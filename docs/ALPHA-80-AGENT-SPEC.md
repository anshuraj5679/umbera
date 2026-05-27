# Alpha 80 Agent Spec

This document defines the agents needed to make Obsidian feel like a live dark-pool venue while keeping the system honest and testable.

## Agent Types

### Maker Bot Agent

Purpose:

- Submit bounded BUY and SELL maker orders across configured pairs.
- Create settled trade history for charts and demos.
- Keep liquidity simulated but realistic.

Inputs:

- Pair ids.
- Side mix.
- Price bands.
- Max notional per order.
- Max notional per batch.
- Inventory budgets.
- Batch cadence.
- Wallet/private key source.

Required safeguards:

- Dry-run mode.
- Max order count per batch.
- Max gas spend per run.
- Refuse unknown pair ids.
- Refuse prices outside configured bands.
- Never print private keys.

### Agent Order API Client

Purpose:

- Let external software submit paid or dev-bypass order intents through the x402-gated matcher API.

Inputs:

- Pair id.
- Side.
- Size.
- Limit price.
- Client order id.
- Payment header or dev-bypass token.

Required safeguards:

- Idempotency by client order id.
- Max notional.
- Max expiry.
- Pair allowlist.
- Response must not echo encrypted private amounts.

### Audit Verifier Agent

Purpose:

- Recompute auction results from signed transcripts and verify matcher accountability.

Inputs:

- S3 audit transcript.
- Deployment address file.
- On-chain match ids.

Required safeguards:

- Recover signer and compare with `dex.matcher()`.
- Recompute clearing price and filled amounts.
- Flag missing or mismatched tx hashes.

### Ops Watchdog Agent

Purpose:

- Detect stuck operational states before demos.

Checks:

- Current batch close-ready too long.
- Closed batch without match publish.
- Pending match past dispute window.
- Repeated CoFHE unseal failures.
- Matcher wallet mismatch.
- DB/indexer lag.

Required safeguards:

- Alert-only first.
- No automatic pause or key rotation in v1.
- Log actionable recovery command.

## First Implementation

The first executable slice is market candles from settled matches. It gives the frontend real venue analytics and creates the data contract needed by the maker bot and chart UI.

## Maker Bot Runner Slice

The first maker-bot implementation is now a guarded CLI runner rather than a daemon:

- Strategy: `matcher/src/maker/strategy.ts`
- Runner: `matcher/src/maker/runner.ts`
- CLI: `matcher/scripts/maker-bot.ts`
- Spec: `docs/specs-alpha-80-maker-bot.md`

Current capabilities:

- Dry-run by default.
- Deterministic fixed-seed plans.
- Crossing mode for demo matched liquidity.
- Resting mode for non-crossing experiments.
- Price bands, pair allowlist by deployment, max orders, max notional per order, and max notional per batch.
- Live submission only through explicit `npm --prefix matcher run maker:execute`.
