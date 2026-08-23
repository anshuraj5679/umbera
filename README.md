# UMBRA

<p align="center">
  <img src="docs/assets/umbra-hero.png" alt="UMBRA confidential dark pool" width="100%" />
</p>

<p align="center">
  <strong>UMBRA is a privacy-first confidential trading application designed to protect sensitive onchain trading intent.</strong>
</p>

<p align="center">
  <img alt="Arbitrum Sepolia" src="https://img.shields.io/badge/Arbitrum%20Sepolia-live-111111?style=for-the-badge&labelColor=000000" />
  <img alt="CoFHE Encryption" src="https://img.shields.io/badge/Fhenix%20CoFHE-encrypted-8b5cf6?style=for-the-badge&labelColor=000000" />
  <img alt="Audit Receipts" src="https://img.shields.io/badge/proof%20receipts-public-9ca3af?style=for-the-badge&labelColor=000000&color=3f4652" />
</p>

---

## Review Links

| Surface | Link |
|:---|:---|
| Live app | https://umbra-darkpool.vercel.app |
| Source repository | https://github.com/anshuraj5679/Obsidian |
| System health | https://umbra-darkpool.vercel.app/api/health |
| Markets API | https://umbra-darkpool.vercel.app/api/markets |
| Recent batches | https://umbra-darkpool.vercel.app/api/batches/recent |
| Match audit receipt | https://umbra-darkpool.vercel.app/api/matches/1/audit |
| Batch proof receipt | https://umbra-darkpool.vercel.app/api/batches/386/audit |
| Agent API docs | [docs/X402-AGENT-API.md](docs/X402-AGENT-API.md) |
| Operator runbook | [docs/RUNBOOK.md](docs/RUNBOOK.md) |

---

## Status Snapshot

| Area | Current State |
|:---|:---|
| **Network** | Arbitrum Sepolia (Chain ID 421614). |
| **Product** | Live app with setup, pool, orders, markets, batches, health, and audit views. |
| **Privacy** | Encrypted order parameters (`euint128`), side-private order design, no plaintext storage for sensitive order fields. |
| **Execution** | Sealed batch auctions, uniform clearing price matching, optimistic settlement, and receipt-only audit flow. |
| **Operations** | Reorg-aware indexer, worker leases, stale-task recovery, dead-letter reporting, and public health checks. |
| **Data Integrity** | Candles and volume are derived from settled matches only. No fake depth or synthetic order book. |

---

## Problem

On-chain trading leaks intent before execution.

Public mempools, calldata, order books, and wallet-linked activity expose direction, size, limit price, and execution urgency. This is especially damaging for large traders, treasuries, market makers, autonomous agents, and any strategy that depends on keeping intent private until execution.

Most DeFi venues optimize for transparency after settlement, but expose too much during order placement and execution. That creates room for copy-trading, adverse selection, MEV, and public strategy leakage.

---

## Solution

UMBRA is a confidential batch-auction dark pool for encrypted on-chain execution.

Traders submit sealed orders against encrypted test assets (`eUSDC` / `eWETH`). Public observers can see lifecycle metadata such as pair, batch, and transaction references, but not private trading intent. The matcher daemon processes closed batches in encrypted state, computes uniform clearing results, publishes settlement, and exposes public proof receipts without persisting raw private auction inputs.

### Trust Assumptions (Stage 1 — "Training Wheels")
- UMBRA V1 uses an authorized matcher for batch clearing.
- Order values are encrypted on-chain (`euint128`).
- Public receipts verify matcher signatures, indexed match fields, tx hashes, and salted commitment roots.

---

## Architecture & Flow

```text
Traders / Agents
    |
    | encrypted order legs (euint128), commitments
    v
Next.js Frontend  <----->  Matcher HTTPS API
    |                         |
    |                         | confirmed indexer
    |                         | batch matcher
    |                         | settlement retry
    |                         | invariant reconciler
    |                         | audit verifier
    v                         v
DarkPoolDEX Contracts  <----  PostgreSQL Database
    |
    | encrypted FHERC20 transfers
    v
Arbitrum Sepolia
```

### Components

- **Frontend (`frontend/`)**: Next.js app on Vercel. Handles wallet connection, encrypted token operator approvals, order entry, orders timeline, markets, and health views.
- **Smart Contracts (`contracts/`)**: `DarkPoolDEX.sol` on Arbitrum Sepolia using Fhenix CoFHE `euint128` encrypted order book, FHERC20 operator model, and optimistic settlement.
- **Matcher Backend (`matcher/`)**: Viem-based confirmed block indexer, batch matcher, settlement retry worker, and public API.
- **Audit System**: Public proof receipts (`umbra.match.proof-receipt.v2`) with salted commitment roots and signed match verification.

---

## Repository Map

```text
contracts/  DarkPoolDEX.sol smart contracts, FHERC20 operator flow, settlement tests
frontend/   Next.js app, wallet flow, order entry, markets, batches, health
matcher/    Confirmed indexer, batch matcher, settlement workers, audit verifier
shared/     Auction logic, pricing, commitment helpers, deployed addresses
docs/       Operator runbook, agent API documentation
```

---

## Local Development Setup

```powershell
cp .env.example .env
pnpm install
pnpm --filter='./contracts' build
npm --prefix matcher run dev
npm --prefix frontend run dev
```

Public deployment environment settings:

```text
NEXT_PUBLIC_CHAIN_ID=421614
NEXT_PUBLIC_DEX_ADDRESS=<dark-pool-dex-address>
NEXT_PUBLIC_WALLETCONNECT_ID=<walletconnect-project-id>
MATCHER_API_URL=https://<public-matcher-api>
```

---

## Verification Commands

```powershell
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

---

## License

This project is licensed under the **Apache License 2.0**. See [`LICENSE`](LICENSE) for details.
