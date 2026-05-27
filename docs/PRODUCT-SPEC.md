# Obsidian Product Spec

## Positioning

Obsidian is a confidential batch-auction venue for large onchain trades. The first wedge is not "another DEX"; it is private execution for DAO treasuries, OTC desks, whales, and market makers who want to express size and limit price without exposing their edge before settlement.

## Product References

| Product | Pattern to Borrow | Obsidian Version |
|---|---|---|
| CoW Protocol | Intent-based trading, batch auctions, solver/operator workflow, MEV-aware execution | Encrypted intents with one trusted matcher in v1; solver competition later |
| UniswapX | Users specify desired outcome and price tolerance; fillers compete on execution quality | Users submit sealed size and limit price; matcher publishes encrypted transfers |
| Penumbra DEX | Batched private/intended swap flow with no exploitable intra-batch ordering | Five-minute encrypted batches on Arbitrum Sepolia |
| RAILGUN | Clear "shield/use/unshield" mental model for private DeFi | Setup flow: faucet, wrap to encrypted token, approve DEX operator, trade privately |

## PMF Hypothesis

If onchain funds can submit large trades without disclosing size or price until after execution, they will prefer Obsidian for trades where public mempool exposure creates slippage, copy-trading, or strategy leakage.

Primary users:
- DAO treasuries swapping six-figure stablecoin inventory into majors.
- Market makers rebalancing inventory without showing intent.
- Whales and funds who need self-custodial execution but cannot use public AMM routes safely.
- Fhenix ecosystem teams needing a flagship confidential DeFi demo.

## Core User Promise

"Submit a private limit order, wait for the batch, and receive fair encrypted settlement without broadcasting your side, size, or price to the market."

## MVP Workflow

1. Connect wallet on Arbitrum Sepolia.
2. Mint test `mUSDC`, `mWETH`, `mWBTC`, `mARB`, or `mLINK`.
3. Wrap plain tokens into encrypted `eUSDC`, `eWETH`, `eWBTC`, `eARB`, or `eLINK`.
4. Set the DEX as time-limited operator for both encrypted pair tokens.
5. Submit a sealed BUY or SELL order encoded as four encrypted legs with no public side field.
6. Close the batch after the timer ends.
7. Operator opens the batch, decrypts only as the authorized matcher, previews uniform clearing, and publishes encrypted matches.
8. Anyone settles after the dispute window.
9. Trader sees encrypted balances updated and can cancel remaining live amount.

## Grant-Ready Acceptance Criteria

The product is grant-demo ready only when all of these are true:

- Trader can complete setup, submit, and cancel an encrypted order from the UI.
- Two crossing orders can be submitted and matched in a live operator flow.
- Operator preview and matcher use the same shared auction library.
- Published matches settle on-chain and update encrypted token balances.
- Order history, batch status, and transaction links are visible without exposing side or private amounts.
- The README has a single-command local or testnet demo path.
- The repo discloses v1 trust assumptions clearly: one matcher key, admin dispute resolution, no fraud proofs yet.

## Product Gaps To Close

| Gap | Why It Matters | Target Fix |
|---|---|---|
| Server matcher FHE disabled | Breaks autonomous end-to-end execution | Integrate `@cofhe/sdk/node` or intentionally move v1 matching to browser operator console |
| Matcher indexing incomplete | Operator cannot rely on backend state | Index `OrderSubmitted`, `BatchClosed`, and match lifecycle events |
| Partial-fill semantics inconsistent | Real dark pools need multiple fills | Keep orders active while encrypted remaining amounts exist |
| Testnet wrapper is incomplete | Users need a clear private token lifecycle | Add unwrap or explicitly document v1 as wrap-only demo collateral |
| Audit checklist overclaims tests | Reviewers will notice missing evidence | Replace missing test names with real tests or "not covered yet" |

## V1 Trust Model

Obsidian v1 is an optimistic, trusted-matcher prototype. The matcher can see decrypted order amounts after users grant access, computes the auction off-chain, then publishes encrypted settlement amounts. On-chain checks ensure the matcher cannot transfer more than remaining escrow, but v1 does not cryptographically prove price fairness. Disputes are reviewed by admin using signed audit logs.

In the side-private ABI, public chain calldata/events do not include BUY/SELL side. Side is encoded through four encrypted token legs and is visible only to the authorized matcher/operator after decryption. Public observers can still see participation metadata such as trader address, pair id, batch id, tx timing, order ids, and match ids.

## V2 Direction

- Solver competition or multi-matcher committees.
- Signed auction transcript with public verifier.
- Fraud proof or ZK proof for clearing-price fairness.
- More pairs and minimum-size gates.
- Mainnet-quality fhERC20 integration, replacing the local wrapper.
- Institutional UI: private RFQ link, counterparty allowlists, CSV order import, and post-trade compliance export.
