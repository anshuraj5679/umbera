# UMBRA — Architecture Specification

## "Private Intent. Verifiable Execution."

UMBRA is a Midnight-native confidential dark-pool DEX designed to execute private trading intents verifiably using Compact zero-knowledge circuits, Midnight.js, and client-side ZK proof generation.

---

## 1. System Components

```text
Trader (Lace Wallet)
    │
    │ 1. Private Order Intent (Side, Amount, Limit Price)
    ▼
UMBRA DApp (Next.js 14)
    │
    │ 2. Compute 32-byte Order Commitment & Nullifier
    ▼
Local Proof Server (Docker :6300)
    │
    │ 3. Generate Zero-Knowledge Proof
    ▼
Midnight Preprod Ledger (Compact Smart Contract: umbra.compact)
    │
    │ 4. Register Commitment & State Verification
    ▼
Batch Auction Matcher (Node.js & PostgreSQL)
    │
    │ 5. Calculate Clearing Price & Publish Proof Receipt (umbra.match.proof-receipt.v3)
    ▼
Settlement Engine
```

### Key Modules

- **Smart Contract (`contracts/midnight/src/umbra.compact`)**: Authored in Compact DSL. Enforces order commitment registration (`submitOrder`), nullifier cancellation (`cancelOrder`), batch closing (`closeBatch`), and settlement roots (`publishMatchResult`).
- **Client Service Layer (`frontend/midnight/`)**:
  - `wallet.ts`: Lace Wallet DApp connector (`window.midnight.mnLace`).
  - `client.ts`: Midnight.js provider factory.
  - `contract.ts`: Typed TypeScript bindings for `umbra.compact`.
  - `privacy.ts`: Client-side commitment calculation, nullifier generation, and privacy matrix.
  - `provider.tsx`: React Context provider managing Lace connection, proof status, and transaction lifecycle.
- **Proof Server (`docker-compose.midnight.yml`)**: Local Docker container (`midnightntwrk/proof-server:8.1.0`) generating ZK proofs locally on port 6300.
- **Audit System (`matcher/src/audit/`)**: Generates proof receipts (`umbra.match.proof-receipt.v3`) containing Midnight transaction references and ZK proof status without revealing private inputs or secret salts.

---

## 2. Privacy Boundary

| Domain | Visibility | Storage Location |
|:---|:---|:---|
| **BUY / SELL Side** | PRIVATE | Encrypted Client State |
| **Order Amount** | PRIVATE | Encrypted Client State |
| **Limit Price** | PRIVATE | Encrypted Client State |
| **Secret Salt** | PRIVATE | Encrypted Client State |
| **32-byte Order Commitment** | PUBLIC | Midnight Preprod Ledger |
| **Batch ID & Lifecycle** | PUBLIC | Midnight Preprod Ledger |
| **Settlement Root** | PUBLIC | Midnight Preprod Ledger |
| **ZK Execution Proof** | VERIFIABLE | Midnight Preprod Ledger |

---

