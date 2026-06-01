# Obsidian

<p align="center">
  <img src="docs/assets/obsidian-hero.png" alt="Obsidian confidential dark pool" width="100%" />
</p>

<p align="center">
  <strong>Confidential dark-pool execution for encrypted onchain trading intent on Arbitrum Sepolia.</strong>
</p>

<p align="center">
  <img alt="Arbitrum Sepolia" src="https://img.shields.io/badge/Arbitrum%20Sepolia-live-111111?style=for-the-badge&labelColor=000000" />
  <img alt="Fhenix CoFHE" src="https://img.shields.io/badge/Fhenix%20CoFHE-encrypted-2b2f36?style=for-the-badge&labelColor=000000" />
  <img alt="Proof receipts" src="https://img.shields.io/badge/proof%20receipts-public-9ca3af?style=for-the-badge&labelColor=000000&color=3f4652" />
</p>

## Review Links

| Surface | Link |
|---|---|
| Live app | https://obsidian-darkpool.vercel.app |
| Source repository | https://github.com/anshuraj5679/Obsidian |
| System health | https://obsidian-darkpool.vercel.app/api/health |
| Markets API | https://obsidian-darkpool.vercel.app/api/markets |
| Recent batches | https://obsidian-darkpool.vercel.app/api/batches/recent |
| Match audit receipt | https://obsidian-darkpool.vercel.app/api/matches/1/audit |
| Batch proof receipt | https://obsidian-darkpool.vercel.app/api/batches/386/audit |
| Agent API docs | [docs/X402-AGENT-API.md](docs/X402-AGENT-API.md) |
| Operator runbook | [docs/RUNBOOK.md](docs/RUNBOOK.md) |

The deployed Vercel app is the primary review surface. A reviewer should be able to open the live URL, connect a wallet, prepare encrypted test assets, submit a private order, inspect lifecycle state, view settled dark-pool candles, inspect recent batches, and verify public health/audit surfaces without running local scripts.

## Status Snapshot

| Area | Current state |
|---|---|
| Network | Public testnet alpha on Arbitrum Sepolia. |
| Product | Live app with setup, pool, orders, markets, batches, health, and audit views. |
| Privacy | Encrypted order legs, side-private order design, no plaintext storage for sensitive order fields. |
| Execution | Trusted V1 matcher, sealed batch auctions, settlement retry, and receipt-only audit flow. |
| Operations | Reorg-aware indexer, worker leases, stale-task recovery, dead-letter reporting, and public health checks. |
| Data integrity | Candles and volume are derived from settled matches only. No fake depth or synthetic order book. |

## What We Achieved

In roughly two months, Obsidian moved from an early encrypted trading prototype into a deployed confidential execution protocol.

- Rebranded and repositioned the product as a confidential dark-pool venue for private onchain trading intent.
- Shipped a live Vercel alpha with setup, wallet connection, encrypted asset preparation, private order submission, order lifecycle, markets, batches, health, and audit views.
- Integrated Fhenix CoFHE through `@cofhe/sdk` for browser and backend encrypted order flows.
- Upgraded order submission so side, size, limit price, and remaining amount are not exposed as plaintext public order fields.
- Hardened backend storage and APIs to avoid plaintext persistence of sensitive order fields.
- Added runtime privacy invariant checks for order storage, audit objects, task payloads, worker errors, x402 access tokens, and relayer state.
- Built autonomous matcher, settlement retry, catchup, repair, stale-task recovery, and dead-letter visibility workers.
- Implemented receipt-only audit surfaces with signed match receipts, salted commitment roots, and batch proof receipts.
- Added account commitments, order commitments, consumed nullifier tracking, and relayer checkpoints.
- Added reorg-aware confirmed indexing, index lag monitoring, rollback support, and proof-anchor catchup.
- Integrated an x402-style agent access layer while keeping access payment separate from encrypted trade execution.
- Removed fake order book, fake depth, and fake volume assumptions. Market candles and volume come from settled matches only.

## Problem

Onchain trading leaks intent before execution.

Public mempools, calldata, order books, and wallet-linked activity expose direction, size, limit price, and execution urgency. This is especially damaging for large traders, treasuries, market makers, autonomous agents, and any strategy that depends on keeping intent private until execution.

Most DeFi venues optimize for transparency after settlement, but expose too much during order placement and execution. That creates room for copy-trading, adverse selection, MEV, and public strategy leakage.

## Solution

Obsidian is a confidential batch-auction dark pool for encrypted onchain execution.

Users submit sealed orders against encrypted test assets. Public observers can see lifecycle metadata such as pair, batch, and transaction references, but not the private trading intent. The V1 matcher is authorized to decrypt order handles inside the auction flow, compute a uniform clearing result, publish settlement, and expose public proof receipts without persisting raw private auction inputs.

Current V1 trust model:

- Obsidian V1 uses a trusted matcher.
- Order values are hidden publicly, but the authorized matcher decrypts for auction execution.
- Public receipts verify matcher signatures, indexed match fields, tx hashes, and salted commitment roots.
- This alpha does not claim decentralized matching, MPC execution, or ZK fairness proofs yet.

## Differentiators

| Differentiator | Why it matters |
|---|---|
| Side-private order model | BUY/SELL side is not stored as plaintext public order state. |
| No plaintext sensitive storage | `side`, `baseAmount`, `limitPrice`, and `remainingBase` are kept out of backend plaintext persistence. |
| Batch-auction execution | Orders are matched in sealed batches instead of exposing intent to continuous public order flow. |
| Receipt-only audit design | Reviewers get signed proofs, tx links, and salted roots without decrypted auction input dumps. |
| Real settled-market data | Candles are derived from settled matches only, with no fake depth or synthetic volume. |
| Runtime privacy guardrails | Health and invariant checks detect privacy regressions before they become silent leaks. |
| Agent-ready access | x402-style access can gate autonomous agents while encrypted order identity remains commitment-based. |
| Production backend posture | Reorg-aware indexing, retries, leases, stale recovery, dead-letter visibility, and operator health are built into the matcher. |
| Honest V1 trust model | The README and product disclose the trusted matcher instead of overstating decentralization. |

## Architecture

```text
Wallet / Agent
    |
    | encrypted order legs, account commitment, order commitment
    v
Next.js Frontend  <----->  Matcher HTTPS API
    |                         |
    |                         | confirmed indexer
    |                         | batch matcher
    |                         | settlement retry
    |                         | invariant reconciler
    |                         | audit verifier
    v                         v
DarkPoolDEX Contracts  <----  Matcher Database
    |
    | encrypted settlement events
    v
Arbitrum Sepolia
```

### Frontend

- Next.js app deployed on Vercel.
- Wallet setup, faucet/wrap/approval flow, private order form, order timeline, markets, batches, and health views.
- CoFHE browser flow configured for deployed COOP/COEP requirements.

### Contracts

- Dark-pool order and settlement contracts on Arbitrum Sepolia.
- Encrypted token flow for confidential order legs.
- Settlement constraints and test coverage for matching, settlement, cancellation, expiry, fee, and transfer boundaries.

### Matcher

- Public HTTPS API used by the Vercel app.
- Confirmed-block indexer with reorg detection and rollback support.
- Autonomous batch close, match, settle, retry, catchup, repair, and reconciliation workers.
- Privacy-safe health reporting and worker error visibility.

### Audit And Proof Surface

- Signed match receipts.
- Batch proof receipts.
- Salted private input and output commitment roots.
- Receipt-only public audit objects.
- Optional proof-anchor guardrails before settlement.

### Health And Operations

- Matcher role check.
- DB status and current batch status.
- Latest indexed block, confirmed block, and indexer lag.
- Closed batches waiting for match.
- Pending settlements past dispute window.
- Recent privacy-safe worker errors.
- Retryable, stale, expired, and dead-letter task visibility.
- Relayer commitment integrity checks.

## Privacy Model

Current implementation:

- Browser and matcher encryption/decryption use `@cofhe/sdk`.
- `decryptForView` is permit-backed for user/operator-readable values.
- `decryptForTx` helper paths are wired for transaction-bound decrypt results.
- The matcher decrypts order legs only in process memory for auction execution.
- The order database stores ciphertext handles and public lifecycle metadata.
- Backend storage avoids plaintext `side`, `baseAmount`, `limitPrice`, and `remainingBase`.
- x402 payment grants short-lived access capability and remains separate from encrypted trading identity.
- Public proof receipts expose salted commitment roots, not private values or private salts.
- Audit objects are receipt-only and do not persist decrypted auction input orders.
- Invariant checks scan for legacy plaintext fields, non-private stored sides, raw access-token storage, private audit fields, and private task/error residue.

## Product Flow

1. Connect wallet on Arbitrum Sepolia.
2. Prepare encrypted test assets.
3. Submit private order from the pool screen.
4. Order enters a sealed batch.
5. Matcher waits for index completeness, closes the batch, and computes the clearing result.
6. Settlement worker publishes the result and retries if the chain path is temporarily unavailable.
7. Orders, batches, markets, health, and audit pages update from real matcher and contract state.

## Repository Map

```text
frontend/   Next.js app, wallet flow, order entry, markets, batches, health
contracts/  DarkPoolDEX contracts, encrypted token flow, settlement tests
matcher/    Indexer, matcher workers, relayer state, x402 agent API, public API
shared/     Auction logic, pricing, commitment helpers, deployed addresses
docs/       Operator runbook, agent API, assets
```

## Local Development

```powershell
cp .env.example .env
pnpm install
pnpm -F contracts build
pnpm -F matcher dev
pnpm -F frontend dev
```

Public deployment settings:

```text
NEXT_PUBLIC_CHAIN_ID=421614
NEXT_PUBLIC_DEX_ADDRESS=<dark-pool-dex-address>
NEXT_PUBLIC_WALLETCONNECT_ID=<walletconnect-project-id>
MATCHER_API_URL=https://<public-matcher-api>
```

Never commit `.env`, private keys, RPC secrets, or deployment wallets.

## Verification

Useful checks before shipping:

```powershell
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix matcher run lint
npm --prefix matcher test
npm --prefix matcher run build
npm --prefix shared test
```

Deployed proof checks:

- Vercel app loads from the public URL.
- Wallet connects on Arbitrum Sepolia.
- CoFHE browser flow works under deployed headers.
- `/api/health` returns healthy matcher, DB, indexer, privacy, worker, and relayer status.
- `/api/markets` and recent batches return real matcher data.
- Match audit receipt returns `obsidian.match.proof-receipt.v2`.
- Batch audit receipt returns `obsidian.batch.proof-receipt.v1`.
- Market candles are derived from settled matches only.

## Roadmap

### Near Term

- Expand live maker liquidity across more test pairs with explicit simulated-liquidity labeling.
- Add stronger public audit verifier UX for proof receipts and batch roots.
- Move x402 agent access to an Arbitrum-compatible plain-token facilitator path.
- Add more adversarial settlement, expiry, cancellation, and oversized-transfer tests.
- Add cleaner reviewer walkthroughs for fresh wallet setup and proof verification.

### Protocol Hardening

- Replace trusted V1 matcher assumptions with multi-matcher or threshold matching.
- Add stronger proof-backed settlement requirements around batch execution.
- Improve private account/session lifecycle with stronger replay and nullifier controls.
- Expand indexer recovery, operator alerts, and incident runbooks.
- Add stronger monitoring around settlement latency, index completeness, and proof-anchor coverage.

### Longer Term

- Decentralized solver/matcher set.
- MPC or threshold decryption for matching.
- ZK or fraud-proof style fairness verification.
- Mainnet readiness after extended public testnet operation.
