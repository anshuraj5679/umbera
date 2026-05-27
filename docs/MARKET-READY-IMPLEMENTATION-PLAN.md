# Market-Ready Implementation Plan

This plan prepares Obsidian for the next implementation pass: moving from a proven testnet demo to a controlled alpha product. It does not claim mainnet readiness yet.

## Current Baseline

- Current Arbitrum Sepolia DEX deployment supports encrypted order submit, batch close, match publish, and encrypted settlement, but it is the pre-side-private ABI.
- Local code now contains a breaking side-private redesign where public chain calldata/events do not include BUY/SELL side. This requires a new DEX deploy, matcher DB migration, matcher redeploy, and Vercel redeploy before it is live.
- CLI demo flow can seed maker liquidity, close batches, match closed batches, and settle after the dispute window.
- Matcher daemon now boots with the real CoFHE node SDK, verifies the on-chain matcher role, catches up indexed events, closes elapsed batches, matches closed batches, publishes encrypted matches, and settles pending matches after on-chain readiness checks.
- UI supports setup, wrapping, operator approvals, order submission, order history, and operator gating.
- The product is still a trusted-matcher prototype. The matcher can decrypt orders after access is granted and there is no cryptographic proof of auction fairness yet.
- The market-ready target is a controlled alpha with honest trust assumptions, strong automation, reliable indexing, and clean user lifecycle UX.
- Autonomous daemon operation completed a certified Arbitrum Sepolia E2E on 2026-05-22, including S3 audit logs and settlement from the EC2 service.
- x402 agent order entry is implemented in the matcher service as a paid HTTP route that can submit encrypted BUY/SELL order intents through a delegated trader wallet. Keep it disabled for judge flow unless an Arbitrum-compatible plain-token facilitator is configured; the Base Sepolia challenge path is useful for integration testing but is not the intended Arbitrum-only alpha payment setup.
- The Arbitrum Sepolia demo venue now has four registered markets: `eUSDC/eWETH`, `eUSDC/eWBTC`, `eUSDC/eARB`, and `eUSDC/eLINK`.
- Four-market daemon operation completed a certified Arbitrum Sepolia E2E on 2026-05-24 in batch `66`, including S3 audit logs and settlement for WETH, WBTC, ARB, and LINK.

## 2026-05-22 Certified Daemon E2E Result

Environment:

- Existing EC2 instance: `darkpool-matcher-dev` in `ap-south-1`.
- DEX: `0x22598DA7799deA8E3ec5337b1DFCBaa53AFE1e55`.
- Matcher wallet matched `dex.matcher()`.
- EC2 IAM role: `darkpool-dev-matcher-ec2-role`.
- Audit bucket: `darkpool-matcher-logs-dev`.

Flow completed:

- Attached the EC2 matcher IAM role and verified audit-object write/read-back from the instance role.
- Hardened RPC catchup with chunking, retries, and a periodic idempotent catchup poller so missed websocket events are backfilled.
- Hardened duplicate event upserts so order and match metadata is refreshed from canonical chain state.
- Added CoFHE decrypt retry for transient threshold-network `503` errors.
- Added `pnpm demo:market:orders` for fast same-batch order seeding after balances/operators are prepared.
- Seeded five maker orders into batch `57`.
- EC2 daemon closed batch `57`: `0xe58f377f853bfea11cf4517451e1b33e6102166b9981eb8d2d47304d7a8289bb`.
- EC2 daemon published WETH match `6`: `0x7496e2f3ab986a10caa2bb57db5d5fdc79465e897f6ca34d300175a1d9ddb4fc`.
- EC2 daemon wrote WETH audit log: `pair-0/batch-57/match-6.json`.
- EC2 daemon settled WETH match `6`: `0x8f7e2ae30f3817bdcea8a85a083ebc73fcf73a606fc848c8931b1bed11166011`.
- EC2 daemon published WBTC match `7`: `0x4f7142cc4e1438830d70628e6a0d11c3ce2ab2c5cae84c5062fa109be2cb82e9`.
- EC2 daemon wrote WBTC audit log: `pair-1/batch-57/match-7.json`.
- EC2 daemon settled WBTC match `7`: `0xb337a2d60554000e83586a65503e6c0690129cc9bbe620a87a45fa8e63b9081a`.

Issues found:

- CoFHE threshold network returned transient `503 Service Unavailable`; unseal retry handled it and the batch still completed.
- Websocket delivery missed some order events; periodic catchup replay corrected the DB and retried batch `57`.
- Empty close-ready batches are now deferred by default to avoid testnet gas churn; `demo:market:orders` can close an empty stale batch intentionally for demos.

## 2026-05-24 Certified Four-Market Daemon E2E Result

Environment:

- Existing EC2 instance: `darkpool-matcher-dev` in `ap-south-1`.
- DEX: `0x22598DA7799deA8E3ec5337b1DFCBaa53AFE1e55`.
- Audit bucket: `darkpool-matcher-logs-dev`.
- EC2 deployment metadata was updated to include pair `2` `eUSDC/eARB` and pair `3` `eUSDC/eLINK`, then `darkpool-matcher.service` was restarted.

Flow completed:

- Seeded nine maker orders into batch `66`.
- EC2 daemon closed batch `66`: `0x44d2e580e96902439e3827dc16779750f101f15cee90f0a23b6ff5946792f269`.
- EC2 daemon published WETH match `17`: `0x7c6e8a9b26dfbc724a0e91847c9c43609b163ae9b4fc62c3804df17bacb58edb`.
- EC2 daemon wrote WETH audit log: `pair-0/batch-66/match-17.json`.
- EC2 daemon settled WETH match `17`: `0x77bd82c071b481cfeed600b30a99f41546a1c389829b8d49d0fce98883b3b1c2`.
- EC2 daemon published WBTC match `18`: `0x69f0070f43b926daee122870ea509f5f8c5e8bc970408310c2e48fc3e9c9fd5d`.
- EC2 daemon wrote WBTC audit log: `pair-1/batch-66/match-18.json`.
- EC2 daemon settled WBTC match `18`: `0x61bb8aee37565f1570734022be7be7033ec7472ef12263fcd5d8ef5fea25b7c0`.
- EC2 daemon published ARB match `19`: `0xbfef4576ca6c961a578feeb4283ab84287426c2cf6474a0af085b7272562f3cf`.
- EC2 daemon wrote ARB audit log: `pair-2/batch-66/match-19.json`.
- EC2 daemon settled ARB match `19`: `0x1cc54681d3bfc02b3fd2cd746e1c21e1e5116f7ff080b624651e8284dffcd240`.
- EC2 daemon published LINK match `20`: `0x045d31bbfefd496b84ccd9691ca6a9ebc569ac58e4a73e1b22e322789a3f393a`.
- EC2 daemon wrote LINK audit log: `pair-3/batch-66/match-20.json`.
- EC2 daemon settled LINK match `20`: `0xa9fa8c35e15f355e2e3fed1cbc8864344b86ca9455a53167b5ade1ceeed7609a`.

Issues found:

- EC2 matcher had stale two-pair deployment metadata after local ARB/LINK registration. Updating `/opt/darkpool/shared/addresses/.deployed-arbSepolia.json` and restarting the service fixed it.
- CoFHE threshold network again returned transient `503 Service Unavailable`; existing unseal retry handled it and the batch completed.

## Market-Ready V1 Scope

Build a reliable, supervised dark-pool venue for testnet or controlled partner alpha:

- Autonomous matcher service.
- Persistent event indexer and batch state database.
- Trader order lifecycle UI from setup to settlement.
- Operator dashboard with audit transcript export.
- Maker/liquidity bot layer for reliable demo depth.
- Hardened contracts around settlement, cancellation, fees, and partial fills.
- Ops runbook, monitoring, key rotation, and incident procedures.

Side-private baseline for the next deployment:

- User-facing UI may let traders choose BUY/SELL.
- Contract calldata/events must not expose side.
- Orders are represented as four encrypted token legs.
- Public APIs must redact side, encrypted handles, plaintext amounts, and buy/sell-labeled match ids.
- Trusted matcher/operator tools may derive side after authorized decryption.

Explicitly out of scope for this pass:

- Decentralized matcher committees.
- ZK proof of auction fairness.
- Mainnet launch.
- Public production liquidity.
- Compliance workflows.

## Implementation Order

### 1. Autonomous Matcher Service

Goal: replace manual CLI operation with a supervised worker.

Build:

- A matcher daemon that watches for close-ready batches.
- Automatic `closeBatch` when the current batch timer has elapsed.
- Automatic event catchup from the last indexed block.
- Automatic decrypt, auction, publish, and settle pipeline.
- Idempotency guards so a batch cannot be matched twice.
- Retry policy for RPC, CoFHE decrypt, tx publish, and settlement.
- Structured audit log per batch.

Acceptance gate:

- Starting the matcher with `pnpm --dir matcher dev` can progress a batch from open to closed to matched to settled without CLI intervention.
- Restarting the matcher mid-batch does not duplicate orders, matches, or settlements.
- Every tx hash is stored and visible in logs.

### 2. Indexer And Database

Goal: the app should not reconstruct everything from RPC logs on each page load.

Build:

- Event cursor table keyed by chain and DEX address.
- Index `BatchOpened`, `BatchClosed`, `OrderSubmitted`, `OrderCancelled`, `MatchPublished`, `MatchSettled`, and `MatchDisputed`.
- Store order metadata and encrypted handles.
- Store side-private encrypted leg handles: base deposit, quote deposit, base request, and quote request.
- Store match metadata and status.
- Add reorg-safe confirmation depth.
- Add an admin backfill command.

Acceptance gate:

- `/orders`, `/batches`, and `/operator` read indexed state first.
- Clearing local DB and running backfill rebuilds the same indexed state from chain.
- Duplicate event processing is harmless.

### 3. Trader Lifecycle UX

Goal: make the product understandable and usable without developer guidance.

Build:

- Single lifecycle panel: faucet, wrap, approve, trade, wait, settle/cancel.
- Per-order status timeline: submitted, batch closed, matched, dispute window, settled, remainder claimable.
- Clear failed-tx and missing-approval states.
- Cancel order flow for unmatched active orders.
- Remainder/claim flow after partial fills.
- Balance refresh with explicit encrypted-balance loading states.

Acceptance gate:

- A new wallet can complete the full testnet flow without CLI help, except for optional maker-bot liquidity.
- The UI never shows success for reverted or unconfirmed txs.
- Every user-visible tx links to the explorer.

### 4. Contract Hardening

Goal: close the highest-risk correctness gaps before any alpha.

Build:

- Tests for malicious matcher oversize transfers.
- Tests for expired order matching.
- Tests for event metadata leakage.
- Tests that public `OrderSubmitted`, `getOrderInfo`, public matcher `/orders`, and public matcher `/matches/:id` do not expose side.
- Tests for cancellation and settlement ACL permissions.
- Tests for fee accounting and fee withdrawal.
- Decide and enforce order status semantics after full and partial fills.
- Consider a `closeReady()` view or batch close helper for cleaner UX.

Acceptance gate:

- Contract test suite covers the failure cases listed in `docs/AUDIT-CHECKLIST.md`.
- A local integration test proves submit -> close -> publish -> settle -> balance update.
- No known settlement path depends on hidden manual ACL fixes.

### 5. Liquidity And Market-Maker Layer

Goal: make the demo market look alive while staying honest.

Build:

- Configurable maker bot profiles per pair.
- Inventory limits and max notional per bot.
- Crossing mode for demos and non-crossing mode for passive depth.
- Batch-aware order staggering.
- Bot tx and inventory dashboard.

Acceptance gate:

- `pnpm demo:market` can run repeatedly without exhausting bot balances.
- The UI shows live batch order count and bot depth status without fake volume or fake price claims.

### 6. Operator Audit Trail

Goal: make the trusted matcher defensible.

Build:

- Signed batch transcript containing order ids, decrypted values, auction result, match amounts, and tx hashes.
- Redacted public transcript for reviewers.
- Admin-only full transcript export.
- Dispute evidence bundle.

Acceptance gate:

- Every published match has an associated signed transcript.
- Transcript signature recovers to the on-chain matcher address.
- A reviewer can reproduce the auction result from the transcript.

### 7. Ops And Security

Goal: make the system deployable and monitorable.

Build:

- Environment validation at boot.
- Health endpoint for matcher and indexer.
- Alerts for failed tx, stalled batch, decrypt failures, and mismatched matcher key.
- Key rotation runbook tested against a fresh deployment.
- Deployment checklist for testnet alpha.

Acceptance gate:

- A fresh machine can deploy, seed, match, and settle using documented commands.
- Matcher refuses to start if its wallet does not equal `dex.matcher()`.
- Incident runbook covers pause, key rotation, redeploy, and data backfill.

## 2026-05-24 Alpha 80 Kickoff

New planning/spec docs:

- `docs/PRODUCTION-80-ROADMAP.md`
- `docs/ALPHA-80-AGENT-SPEC.md`
- `docs/specs-alpha-80-market-candles.md`

First implemented slice:

- Matcher candle aggregation from settled matches only.
- API: `GET /markets/:pairId/candles?interval=5m&limit=200`.
- Candles preserve scaled fractional clearing prices, so ARB `1.175` and LINK `18.75` are not rounded down.
- Frontend `/markets` route renders a real candlestick/volume view through a same-origin Next proxy at `/api/markets/:pairId/candles`.

Verification:

- `npm --prefix matcher test`
- `npm --prefix matcher run lint`
- `npm --prefix shared test`
- `npm --prefix frontend run typecheck`
- `npm --prefix matcher run build`

## 2026-05-25 Maker Bot Runner Slice

Implemented:

- Deterministic maker planning with default WETH, WBTC, ARB, and LINK profiles.
- Crossing mode for candle-producing demo batches.
- Resting mode for non-crossing liquidity tests.
- Price-band, pair-id, order-count, per-order notional, and per-batch notional guards.
- Dry-run CLI:

```powershell
npm --prefix matcher run maker:dry-run
```

- Explicit live CLI:

```powershell
npm --prefix matcher run maker:execute
```

No live transactions are submitted by dry-run. Live mode uses the existing agent order service so order encryption and submission stay on the same path as `/agent/orders`.

Live proof:

- Batch `75` produced maker-bot match `29` on ARB.
- Clearing price: `1.17458847`.
- Publish tx: `0x45e23c8cbec0b0b50ea841b6caaea899e0d6c1f103d11a335e925ed9ec9cdfb6`.
- Settle tx: `0x588322ebddc342e3f29f310b238147377d161b19a0e8b4a3048eaf909cd151df`.
- Candle API includes the new settled ARB candle.

Observed ops issue:

- Judge/testnet environments should use a 300-second batch duration so sequential CoFHE submissions have room to land in the same batch.
- The close/index race is now guarded in the daemon: after `BatchClosed`, matching waits for `MATCHER_BATCH_MATCH_DELAY_SEC`, compares DB order rows with `batchOrderCount(batchId)`, and leaves the batch `CLOSED` for retry if the index is behind.
- `ops:match-batch` remains an explicit recovery tool; it can bypass the delay but still honors the index-completeness gate before marking a batch `MATCHED_EMPTY`.

## First Build Target

The next implementation should start with the autonomous matcher service.

Reason:

- It removes the biggest demo-to-product gap.
- It forces the indexer, retry, idempotency, and audit-log design to become real.
- It turns the current CLI proof into an actual product backend.

Initial task list:

1. Done: move the working CLI decrypt, match, publish, and settle path into `matcher/src`.
2. Done: wire workers for close, closed-batch matching, publish, and settle.
3. Done: persist indexed orders, batches, matches, tx hashes, audit keys, and worker errors in the matcher DB.
4. Done: add process-level in-flight guards and DB idempotency checks before publishing a closed batch.
5. Done with caveats: run a fresh Arbitrum Sepolia end-to-end test using only the daemon and frontend.

## Alpha Launch Definition

Obsidian is alpha-ready only when:

- A trader can use the UI without CLI instructions.
- The matcher daemon can run unattended for several batches.
- The database can be rebuilt from chain.
- Settlement and cancellation are covered by tests.
- Trust assumptions are visible in the product and docs.
- A demo reviewer can verify tx hashes, batch state, and audit transcripts.
