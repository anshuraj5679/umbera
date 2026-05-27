# Dark Pool DEX — Architecture & Design Decisions

## Why This Contract Is Different From Your Blueprint

The blueprint had a solid foundation but several gaps that would break under real
conditions. Here's what changed and why.

---

## 1. Deposit/Request Model (Replaces Price × Amount)

### The Problem
The blueprint used `euint64 price` and `euint128 amount` separately, then needed
`price × amount` to compute payment at settlement. But:

- `euint64 × euint128` can produce results exceeding `euint128` (no `euint256` in CoFHE)
- A $100 token price (100 × 10^18) × 1000 tokens (1000 × 10^18) = 10^41, which
  overflows `euint128` (max ~3.4 × 10^38)
- Cross-multiplication for price comparison has the same overflow problem

### The Solution
Each order stores two encrypted amounts:
- **depositAmount**: tokens the trader locks as escrow
- **requestAmount**: tokens the trader wants in return

The client computes `depositAmount = maxPrice × requestAmount` off-chain (in plaintext,
before encrypting). On-chain, the contract never multiplies two encrypted 128-bit values.

**Settlement transfers deposit ↔ request directly. No multiplication needed.**

```
BUY order:  deposit 5000 eUSDC,  request 2 eWETH  → implicit price: $2500/ETH
SELL order: deposit 2 eWETH,     request 4800 eUSDC → implicit price: $2400/ETH
Match:      2 eWETH goes to buyer, 4900 eUSDC goes to seller (midpoint price)
            buyer gets back 100 eUSDC remainder
```

---

## 2. FHERC20 Operator Model (Replaces ERC20 Approve)

### The Problem
The blueprint used standard `transferFrom` with allowances. But FHERC20 v0.3.x
replaced allowances with **time-limited operators** to prevent encrypted balance
leakage. A fixed encrypted allowance that gets decremented reveals transfer sizes
through balance-change indicators.

### The Solution
Users call `setOperator(darkPoolAddress, deadline)` on the FHERC20 token before
submitting orders. The DEX then uses `confidentialTransferFrom` as an operator.

**Why operators are better for dark pools:**
- No encrypted allowance amount stored on-chain (no leakage)
- Time-limited: operator permission auto-expires
- Simpler: binary yes/no instead of tracking remaining allowance

---

## 3. Optimistic Settlement With Dispute Window

### The Problem
The blueprint's settlement called `FHE.decrypt()` synchronously to get cleartext
prices, then computed transfers in plaintext. This has three issues:
1. Decryption is async in CoFHE (50ms–5s), not synchronous
2. Decrypting prices on-chain defeats the privacy model
3. Plaintext `transferFrom` amounts are visible to everyone

### The Solution
Settlement is fully encrypted — **nothing is ever decrypted on-chain**.

The flow:
1. Matcher publishes match with encrypted transfer amounts (how much each party gets)
2. 30-minute dispute window starts
3. Either party can dispute if they believe the match is unfair
4. After the window, anyone calls `settleMatch()` → encrypted FHERC20 transfers execute
5. Disputed matches are resolved by admin (Stage 1) or fraud proofs (Stage 2)

**What's verified on-chain (in FHE, no decryption):**
- `baseTransfer ≤ buyer's remaining deposit`  (seller can't drain buyer)
- `quoteTransfer ≤ seller's remaining deposit` (buyer can't drain seller)
- Both orders are in the correct pair and batch

**What's trusted to the matcher (Stage 1):**
- Price fairness (that the settlement price is within both parties' limits)
- Pro-rata allocation for partial fills

This is the same trust model as most institutional dark pools (e.g., Liquidnet),
where the matching engine is a trusted intermediary with audit trails.

---

## 4. On-Chain Fee Computation in FHE

### The Problem
Computing `fee = amount × 0.002` requires either:
- Decrypting the amount (leaks it)
- Multiplying two encrypted values (potential overflow)

### The Solution
```
fee = FHE.div(FHE.mul(amount, feeBps), BPS)
```
Where `feeBps = 20` and `BPS = 10000` are **plaintext constants**. Since `feeBps`
is tiny (max 100), `amount × 100` never overflows `euint128`. Then division by
the plaintext constant 10000 is safe.

Fees accumulate in encrypted pools per trading pair. The fee collector withdraws
them as encrypted FHERC20 tokens — even the protocol doesn't know exact fee amounts
until they unseal client-side.

---

## 5. Partial Fill Support

### The Problem
The blueprint assumed full fills only. But in production, a $500K buy order might
only partially match against several smaller sell orders.

### The Solution
Each order tracks `remainingDeposit` and `remainingRequest` separately from the
original amounts. After a match:

```
order.remainingDeposit -= validBaseTransfer   (what was taken)
order.remainingRequest -= validQuoteTransfer  (what was received)
```

An order stays ACTIVE for further matching until:
- It's fully filled (remaining ≈ 0)
- The trader cancels it
- It expires

Traders can call `withdrawRemainder()` to pull back unfilled portions after a
partial match.

---

## 6. Event Privacy (Fixed Metadata Leakage)

### What the blueprint leaked:
- `BatchClosed(batchId, orderCount)` — reveals exact volume per batch
- `MatchSettled(..., price, amount)` — reveals cleartext prices and sizes

### What this contract emits:
```
OrderSubmitted(orderId, pairId, batchId, trader, side)  ← no amounts
BatchClosed(batchId, timestamp)                          ← no order count
MatchPublished(matchId, batchId, buyOrderId, sellOrderId) ← no amounts
MatchSettled(matchId)                                    ← no amounts
```

**An observer learns:** that a match happened between two order IDs.
**An observer does NOT learn:** price, size, fill amount, or any token values.

Side (BUY/SELL) is intentionally plaintext — this is standard for dark pools.
Hiding the side would require the matcher to compare every order against every
other order regardless of direction, which is O(n²) in FHE operations.

---

## 7. Access Control & Emergency Mechanisms

### Roles:
| Role | Can Do | Cannot Do |
|------|--------|-----------|
| **Admin** | Pause, register pairs, set params, resolve disputes | See encrypted data, execute trades |
| **Matcher** | Publish matches for closed batches | Settle matches, withdraw fees |
| **Fee Collector** | Withdraw accumulated fees | Anything else |
| **Traders** | Submit/cancel orders, dispute matches, withdraw | Access other traders' data |
| **Anyone** | Close elapsed batches, settle undisputed matches | — |

### Emergency:
- **pause()**: Freezes all order submission and settlement
- **Circuit breaker**: `maxOrdersPerBatch` prevents gas bomb attacks
- **Two-step admin transfer**: Prevents accidental lockout
- **Order expiry**: Stale orders auto-invalidate

### What admin CANNOT do:
- Decrypt any encrypted order data
- Move escrowed tokens (only traders and settlement can)
- Bypass the dispute window

---

## 8. Attack Surface Analysis

| Attack | Mitigation |
|--------|------------|
| **MEV / front-running** | All order data encrypted; validators see only opaque ciphertexts |
| **Sandwich attacks** | Batch auction model — no sequential ordering within batch |
| **Malicious matcher** | Dispute window + on-chain size validation in FHE |
| **Reentrancy** | Manual reentrancy guard on all state-changing functions |
| **Denial of service** | maxOrdersPerBatch, pause mechanism, minOrderSize |
| **Stale order griefing** | Expiry timestamps, manual cancellation |
| **Fee manipulation** | Hard ceiling (MAX_FEE = 1%), admin-only updates |
| **Metadata leakage** | Minimal events, no counts, no amounts in plaintext |
| **Operator abuse** | Time-limited FHERC20 operators with explicit deadlines |

---

## 9. What's NOT Covered (Future Work)

- **Fraud proofs for matching**: Stage 2 will replace admin dispute resolution
  with ZK proofs that the matcher followed the algorithm correctly.
- **Cross-batch matching**: Currently orders can only match within or across
  closed batches. Continuous matching requires a fundamentally different architecture.
- **Multiple fills per settlement TX**: Each `settleMatch` call handles one match.
  Batched settlement would reduce gas but adds complexity.
- **Oracle integration**: No external price feeds. The matcher determines fair
  clearing prices. Adding a TWAP oracle for sanity checks is recommended.
- **Governance**: All parameters are admin-controlled. DAO governance is out of scope.
- **Gas optimization**: The contract prioritizes correctness and readability.
  Gas-golf (packed storage, assembly) is a post-audit optimization.

---

## 10. Deployment Sequence

```
1. Deploy MockFHERC20 tokens (testnet) or FHERC20Wrapper tokens (production)
   - eUSDC = new MockFHERC20("Encrypted USDC", "eUSDC", 6)
   - eWETH = new MockFHERC20("Encrypted WETH", "eWETH", 18)

2. Deploy DarkPoolDEX(admin, matcher, feeCollector)

3. Register trading pairs
   - dex.registerPair(eUSDC.address, eWETH.address, minOrderSize)

4. Configure parameters
   - dex.setBatchDuration(5 minutes)
   - dex.setDisputeWindow(30 minutes)
   - dex.setFeeRate(20)  // 0.20%

5. Mint test tokens & set operators
   - eUSDC.mint(trader, 1_000_000e6)
   - eUSDC.setOperator(dex.address, block.timestamp + 30 days)

6. Start trading
   - dex.submitOrder(pairId, BUY, encDeposit, encRequest, expiry)
```

---

## 11. FHERC20 Integration Notes

The contract uses two interfaces for FHERC20 interaction:

**IFHERC20** — for user-initiated transfers (InEuint128 calldata):
- Used in `submitOrder` to pull tokens from user → DEX

**IFHERC20Vault** — for contract-held transfers (euint128 handles):
- Used in `cancelOrder`, `settleMatch`, `withdrawFees`, `withdrawRemainder`
- The DEX holds tokens and needs to transfer them using existing euint128 handles

If your FHERC20 implementation doesn't expose a `confidentialTransfer(address, euint128)`
for contract callers, you have two options:
1. Extend the FHERC20 with this function (recommended)
2. Deploy a VaultAdapter contract that inherits FHERC20 and exposes internal `_transfer`

---

## 12. Testing Strategy

### Unit Tests (LocalFhenix):
- Order submission + escrow verification
- Order cancellation + refund
- Batch open/close lifecycle
- Match publishing with FHE validation
- Settlement after dispute window
- Partial fill + remainder withdrawal
- Fee accumulation + withdrawal
- Access control (unauthorized calls revert)
- Circuit breaker (batch full, pause)

### Integration Tests (Arbitrum Sepolia):
- Real CoFHE coprocessor latency
- FHERC20Wrapper wrap/unwrap flow
- Actual gas cost measurement
- Multi-user concurrent order submission
- End-to-end: submit → match → settle → verify balances

### Adversarial Tests:
- Submit order with zero deposit (should create zero-value escrow, harmless)
- Matcher publishes transfer > deposit (FHE.select zeros it out)
- Cancel already-matched order (reverts)
- Settle before dispute window (reverts)
- Reentrancy attempt on settlement (reverts)

---

## 13. Verified Against Fhenix CoFHE Docs (cofhe-docs.fhenix.zone)

The following was verified line-by-line against the official documentation:

### Confirmed Correct:
- `FHE.add`, `sub`, `mul`, `div` all supported on `euint128` ✓
- `FHE.lte`, `gte`, `eq` comparisons return `ebool` ✓
- `FHE.select(ebool, euint128, euint128)` for encrypted branching ✓
- `FHE.and(ebool, ebool)` for combining conditions ✓
- `FHE.allowThis()`, `FHE.allow(handle, address)`, `FHE.allowSender()` ✓
- `FHE.asEuint128(uint256)` for trivial encryption of plaintext constants ✓
- `InEuint128 calldata` accepted (docs show both `memory` and `calldata`) ✓
- Arithmetic is unchecked (wrap-around on overflow, no revert) — acknowledged ✓
- Uninitialized handles treated as 0 by FHE functions ✓
- No `FHE.decrypt()` synchronous call exists — decryption is multi-step
  (allowPublic → off-chain decryptForTx → publishDecryptResult) — contract
  correctly avoids decryption entirely ✓

### Bugs Found and Fixed:
1. **FHE.mul/div with plaintext operands** — `FHE.mul(euint128, uint256)` does NOT
   compile. All FHE operations require both operands to be the same encrypted type.
   Fixed: trivially encrypt `feeBps` and `BPS` via `FHE.asEuint128()` before use.
2. **Missing FHE.allowThis on reset zeros** — After resetting accumulated fees to
   `FHE.asEuint128(0)`, the contract must call `FHE.allowThis()` on the new handle
   so future transactions can use it. Ciphertext handles are only accessible for
   the duration of the creating transaction without explicit `allowThis`.

### Not Yet Verified (Requires Testing):
- **IFHERC20Vault interface** — The `confidentialTransfer(address, euint128)` overload
  for contract-held handles is NOT in the standard FHERC20. You MUST verify this
  exists in your FHERC20 implementation or write an adapter.
- **Security zones** — Contract uses the default security zone. If your deployment
  uses custom zones, all `FHE.asEuint128()` calls need the zone parameter.
- **Gas costs** — The number of FHE operations per `publishMatches` call (12+ per
  match: 2 lte, 2 select, 1 and, 2 select, 2 mul, 2 div, 4 sub, 2 add) needs
  benchmarking on Arbitrum Sepolia to confirm it fits within block gas limits.
