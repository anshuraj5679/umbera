# Production 80 Percent Roadmap

This roadmap is the working plan for moving Obsidian from a strong testnet demo toward a 70-80% production-grade dark-pool DEX. It does not claim mainnet readiness. The target is a credible alpha system with real encrypted order flow, truthful post-trade market data, autonomous demo liquidity, reproducible audit evidence, and operational controls.

## Target Definition

Obsidian reaches the 70-80% milestone when these are all true:

- A trader can complete the order lifecycle from setup to settlement without CLI help.
- The EC2 matcher can run unattended across repeated batches.
- Maker bots create honest, bounded demo liquidity across WETH, WBTC, ARB, and LINK.
- The app shows real post-settlement market analytics, including dark-pool clearing price candles.
- Every published match has a signed audit transcript and an indexed tx trail.
- Contract and auction tests cover the highest-risk settlement and partial-fill cases.
- Ops can detect, pause, recover, and rotate keys without losing indexed state.

## Workstreams

### 1. Market Data And Candles

Goal: make the product feel like a real venue without exposing hidden liquidity.

Build:

- Matcher API for settled-match candles.
- Pair and interval selectors in the frontend.
- Volume bars using settled filled amounts.
- Empty states for pairs without settled trades.
- Clear labeling: "Dark Pool Clearing Price".

Acceptance:

- Candles are generated only from `SETTLED` matches.
- No pending order amount, hidden depth, or live private orderbook is exposed.
- Fractional prices such as ARB `1.175` and LINK `18.75` are preserved.

### 2. Maker Bot Layer

Goal: replace manual maker seeding with bounded, repeatable demo liquidity.

Build:

- Bot profiles per pair with max notional and inventory caps.
- Batch-aware order submission cadence.
- Spread and price jitter config.
- Separate bot wallet support.
- Dry-run mode for planned orders.

Acceptance:

- Bots can submit crossing and non-crossing profiles without exhausting balances.
- Bot activity is disclosed as simulated demo liquidity.
- Failed bot txs are logged and do not stall the matcher daemon.

### 3. Trader Lifecycle UX

Goal: remove operator/developer mental overhead from the user flow.

Build:

- Per-order timeline: submitted, batch closed, matched, dispute window, settled.
- Cancel unmatched active orders.
- Partial-fill and remainder display.
- Settlement tx links.
- Clear approval and encrypted-balance loading states.

Acceptance:

- A new wallet can complete the testnet flow from UI alone.
- The UI never reports success before tx receipt confirmation.
- Private amounts remain hidden unless the wallet has permission to decrypt.

### 4. Audit And Dispute Evidence

Goal: make trusted matching defensible.

Build:

- Signed batch transcript with order ids, decrypted values, auction result, tx hashes.
- Public redacted transcript with match ids, pair ids, clearing price, and signatures.
- Verifier script that recomputes matches from transcript.
- Dispute evidence bundle command.

Acceptance:

- Transcript signature recovers to `dex.matcher()`.
- Recomputed auction output matches published transfers.
- Every match row has an S3 audit key or an explicit audit write error.

### 5. Contract And Auction Hardening

Goal: reduce correctness risk before alpha.

Build:

- Tests for oversized matcher transfers.
- Tests for expired order matching.
- Tests for fee accounting and fee withdrawal.
- Tests for cancellation after partial fills.
- Tests for fractional clearing prices and repeated partial fills.

Acceptance:

- Shared auction tests pass with property checks.
- Contract tests cover the highest-risk paths in `docs/AUDIT-CHECKLIST.md`.
- No known settlement bug depends on manual operator behavior.

### 6. Indexer And Ops Reliability

Goal: make backend state dependable.

Build:

- Reorg-safe confirmation depth for indexed state.
- Backfill command with explicit start/end block.
- Health endpoint with chain, DB, matcher role, and lag.
- Alerts for stuck batches, decrypt failures, failed publish, failed settle.
- Key rotation and pause recovery runbook.

Acceptance:

- Clearing DB and running backfill rebuilds orders, batches, matches, and statuses.
- Restarting the matcher does not duplicate publish or settle txs.
- Health endpoint exposes actionable red/yellow/green state.

## Execution Order

1. Market candles API and tests.
2. Frontend market chart from real settled data.
3. Done: maker bot dry-run and local tests.
4. Maker bot live guarded mode on EC2.
5. Trader lifecycle UI.
6. Audit transcript verifier.
7. Contract hardening tests.
8. Ops health, alerts, and runbook update.

## Current Caveats

- V1 remains a trusted-matcher system.
- The 300-second dispute window is enforced on-chain and cannot be skipped on the current deployment.
- The local machine is using Node `v25.2.1`; normal development should use Node `>=22 <23`.
- Existing batch `70` was started for final scaled-price certification and may finish asynchronously on EC2.
