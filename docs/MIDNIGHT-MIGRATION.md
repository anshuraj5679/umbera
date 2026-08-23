# UMBRA — Midnight Migration Architecture & Specification

## Executive Summary

UMBRA is migrating its privacy and settlement layer from **Fhenix CoFHE** (Fully Homomorphic Encryption over EVM) to **Midnight Network** (Zero-Knowledge Native Compact Smart Contracts).

- **Positioning**: *"Private Intent. Verifiable Execution."*
- **Target Network**: Midnight Preprod Testnet
- **Compact Contract**: [`contracts/midnight/src/umbra.compact`](file:///d:/midnight/contracts/midnight/src/umbra.compact)
- **Proof Receipt Schema**: `umbra.match.proof-receipt.v3`

---

## Architectural Changes

### 1. Privacy Model
- **Fhenix V1 Model**: Orders were stored on-chain as encrypted handles (`euint128`). Matcher decrypted order handles in process memory via authorized permit keys.
- **Midnight V2 Model**: Order parameters (`side`, `amount`, `limitPrice`) stay strictly in local client state. Orders are registered on the public ledger as 32-byte commitments verified by Compact zero-knowledge circuits. Replay protection is enforced via private nullifiers (`spentNullifiers`).

### 2. Contract Architecture
- Smart contract logic is authored in **Compact DSL** (`umbra.compact`).
- Public ledger state maintains:
  - `orderCommitments`: Map of Bytes<32> -> OrderStatus
  - `spentNullifiers`: Set of Bytes<32>
  - `batchStatuses`: Map of Uint<64> -> BatchStatus
  - `settlementRoots`: Map of Uint<64> -> Bytes<32>
  - `currentBatchId`: Uint<64>

---

## Audit Receipts (Schema v3)

Proof receipts are published under the **`umbra.match.proof-receipt.v3`** schema:

```json
{
  "schema": "umbra.match.proof-receipt.v3",
  "matchId": "9821",
  "batchId": "3821",
  "pairId": 0,
  "auctionAlgorithm": "uniform-clearing-v1",
  "clearingPriceQuotePerBaseScaled": "2500000000",
  "baseFilled": "100000000",
  "quoteFilled": "250000000000",
  "privateInputRoot": "0x...",
  "privateInputCount": 2,
  "outputRoot": "0x...",
  "outputMatchCount": 1,
  "salted": true,
  "publishedAt": "2026-08-23T22:00:00Z",
  "txHash": "0x...",
  "matcherAddress": "0x..."
}
```

Receipts verify settlement integrity without disclosing raw order fields or private salts.
