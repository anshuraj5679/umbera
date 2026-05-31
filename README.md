# Obsidian

<p align="center">
  <img src="docs/assets/obsidian-hero.png" alt="Obsidian confidential dark pool" width="100%" />
</p>

<p align="center">
  <strong>Confidential batch-auction dark pool for encrypted onchain execution.</strong>
</p>

<p align="center">
  <img alt="Arbitrum Sepolia" src="https://img.shields.io/badge/Arbitrum%20Sepolia-live-111111?style=for-the-badge&labelColor=000000" />
  <img alt="Fhenix CoFHE" src="https://img.shields.io/badge/Fhenix%20CoFHE-encrypted-2b2f36?style=for-the-badge&labelColor=000000" />
  <img alt="Proof receipts" src="https://img.shields.io/badge/proof%20receipts-public-9ca3af?style=for-the-badge&labelColor=000000&color=3f4652" />
</p>

<p align="center">
  <a href="https://obsidian-darkpool.vercel.app">Live App</a>
  ·
  <a href="https://obsidian-darkpool.vercel.app/api/health">System Health</a>
  ·
  <a href="https://obsidian-darkpool.vercel.app/api/batches/386/audit">Batch Proof Receipt</a>
</p>

Obsidian is a private execution venue for traders, treasuries, market makers, and autonomous agents that need to express size and limit price without lighting up the public market before execution.

The current alpha runs on Arbitrum Sepolia with Fhenix CoFHE encryption. Users submit sealed orders, the trusted V1 matcher decrypts only inside the auction flow, matches orders in batches, publishes encrypted settlement, and exposes public audit receipts that let reviewers verify what happened without revealing private auction inputs.

## Dark Pool Surface

The review surface is the deployed product, not a local script:

```text
https://obsidian-darkpool.vercel.app
```

From the live app a reviewer can connect a wallet, prepare encrypted test assets, submit a private order, inspect order lifecycle, watch settled dark-pool candles, review recent batches, and check matcher health.

What is live today:

- Arbitrum Sepolia deployment using encrypted test assets such as `eUSDC` and `eWETH`.
- Wallet setup, faucet, wrapping, approvals, private order entry, orders, markets, batches, and health views.
- Side-private order ABI where public calldata does not expose BUY/SELL side.
- Backend order storage that avoids plaintext `side`, `baseAmount`, `limitPrice`, and `remainingBase`.
- Autonomous matcher workers for batch close, match, settlement retry, catchup, and health reporting.
- Market candles built only from settled matches.
- Public match and batch audit receipts with salted commitment roots.
- Receipt-only audit storage: signed proof receipts and salted roots without persisted decrypted auction inputs.
- Agent order entry path where x402 buys short-lived access, then encrypted trading uses account commitments.

## Execution Core

Obsidian is not an AMM with a fake private skin. It is built around sealed batch execution:

| Layer | Obsidian behavior |
|---|---|
| Order entry | Traders submit encrypted order legs and public lifecycle metadata. |
| Privacy | Public observers see participation metadata, not side, size, limit price, or remaining amount. |
| Matching | A trusted V1 matcher decrypts authorized handles in memory, computes a uniform clearing result, and publishes encrypted fills. |
| Settlement | On-chain settlement transfers encrypted assets within escrow limits. |
| Proofs | Public receipts expose verifier status, signatures, tx links, and salted roots instead of raw private inputs. |
| Markets | Candles are built only from settled dark-pool matches. No fake depth, no fake order book, no synthetic volume. |

## The Edge

The product is shaped around the hardest parts of confidential execution:

- Confidential intent: side, size, price, and remaining amount stay out of public calldata and backend plaintext storage.
- Batch fairness: orders clear through uniform batch auctions rather than public mempool racing.
- Auditability without disclosure: receipts prove matcher signature validity, indexed tx consistency, and salted input/output roots.
- Deployed review surface: judges and users can test the product from Vercel instead of relying on local scripts.
- Agent-native access: automated agents can pay for access separately from encrypted trading identity.
- Production-grade backend: reorg-aware indexing, retry workers, relayer state, account commitments, and public proof receipts.

## Live Proof Surface

```text
Frontend              https://obsidian-darkpool.vercel.app
Health                https://obsidian-darkpool.vercel.app/api/health
Markets               https://obsidian-darkpool.vercel.app/api/markets
Recent batches        https://obsidian-darkpool.vercel.app/api/batches/recent
Match audit receipt   https://obsidian-darkpool.vercel.app/api/matches/1/audit
Batch audit receipt   https://obsidian-darkpool.vercel.app/api/batches/386/audit
```

## Privacy Model

Current implementation:

- Browser and matcher encryption/decryption use `@cofhe/sdk`.
- `decryptForView` is permit-backed for user/operator-readable values.
- `decryptForTx` helper paths are wired for transaction-bound decrypt results.
- The matcher decrypts order legs only in process memory for auction execution.
- The order database stores ciphertext handles and public lifecycle metadata.
- The order database does not store plaintext `side`, `baseAmount`, `limitPrice`, or `remainingBase`.
- x402 payment grants a short-lived access capability; order submission uses account commitments and does not store the payer identity with the order.
- Public proof receipts expose salted commitment roots, not private values or private salts.
- Audit objects are receipt-only and do not persist decrypted auction input orders.

V1 trust model:

- Obsidian V1 uses a trusted matcher.
- Order values are hidden publicly, but the authorized matcher decrypts for auction execution.
- Signed proof receipts verify indexed match fields, matcher signatures, tx hashes, and salted roots.
- This alpha does not claim decentralized matching or ZK fairness proofs.

## System Map

```text
frontend/
  Next.js app, wallet flow, setup, pool, orders, markets, batches, health

contracts/
  DarkPoolDEX contracts, encrypted token flow, settlement constraints, tests

matcher/
  Indexer, matcher workers, settlement retry, relayer state, audit verifier, public API

shared/
  Auction logic, pricing, commitment helpers, deployed addresses

docs/
  Operator runbook, agent API docs, README assets
```

## Local Development

```powershell
cp .env.example .env
pnpm install
pnpm -F contracts build
pnpm -F matcher dev
pnpm -F frontend dev
```

The deployed product uses these public-facing settings:

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

Current deployed proof slice should be verified with:

- Vercel health returning `ok: true`
- Direct matcher health returning `ok: true`
- Match audit receipt returning `obsidian.match.proof-receipt.v2`
- Batch audit receipt returning `obsidian.batch.proof-receipt.v1`
- Salted private input and output roots present for the live proof batch

## Docs

- [Agent API](docs/X402-AGENT-API.md)
- [Runbook](docs/RUNBOOK.md)
