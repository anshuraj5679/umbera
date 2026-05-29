# Obsidian Proof-Moat Protocol Plan

## Goal

Move Obsidian from a trusted-matcher alpha toward a proof-backed confidential venue without compromising order privacy. The immediate wedge is public verification receipts: anyone can see that a match is tied to a signed matcher transcript and deterministic verifier result, while private auction inputs stay out of public APIs.

## Privacy Boundary

Public APIs must never expose:

- BUY/SELL side.
- Decrypted order size, limit price, or remaining amount.
- CoFHE ciphertext handles.
- Private S3 audit keys or raw transcript bodies.
- Unsalted hashes of private order inputs that could be brute-forced.

Operator-only artifacts may contain decrypted auction inputs for v1 dispute review. Those artifacts remain private and are verified server-side.

## Phase 1: Public Proof Receipts

Status: implemented in matcher verifier/API.

Each public `GET /matches/:id/audit` response returns:

- `ok`: final verifier status.
- `receipt.schema = obsidian.match.proof-receipt.v1`.
- Neutral match coordinates: match id, batch id, pair id, neutral order ids, publish tx hash.
- Signed transcript digest and matcher signature status.
- Deterministic verifier checks: field consistency, auction recompute status, transcript schema, published timestamp.
- Salted commitment roots:
  - `privateInputRoot`: commitment to private auction inputs.
  - `outputRoot`: commitment to verifier output matches.
  - `salted`: true for new transcripts that include the private proof salt.

New private transcripts include `privateProofSalt`. The salt stays in the private S3 transcript, so public roots commit to the private evidence without making simple amount/side brute-force attacks practical.

## Phase 2: Canonical Batch Commitments

Add a canonical batch proof model:

- Batch input root from order commitments.
- Batch output root from encrypted settlement deltas.
- Match nullifier root for consumed order liquidity.
- Relayer state root after settlement.

The verifier should produce a single batch receipt that links all per-match receipts to one batch state transition.

## Phase 3: On-Chain Anchoring

Upgrade contracts to emit or store:

- Batch input root at close.
- Output root at match publication.
- Settlement root after dispute window.
- Verifier/proof adapter address for future proof systems.

This lets public receipts compare against on-chain commitments instead of relying only on matcher-hosted API output.

## Phase 4: Proof Adapter

Introduce a proof adapter interface before choosing a final proof system:

- `TRUSTED_TRANSCRIPT`: current v1 receipt mode.
- `FRAUD_PROOF`: deterministic recomputation can challenge bad output.
- `ZK_PROOF`: proof verifies fair clearing without revealing inputs.
- `THRESHOLD_MATCHER`: multiple matchers co-sign the same output roots.

The API should expose the active mode per batch and never overclaim stronger guarantees than the deployed adapter provides.

## Phase 5: Multi-Matcher Roadmap

After the single-relayer task/indexer state machine is stable:

- Add matcher committee membership and key rotation.
- Require threshold signatures on batch output roots.
- Move decryption/matching toward threshold decryption or MPC.
- Add p2p/gossip only after deterministic replay, reorg recovery, and proof receipts are stable.

## Current Trust Statement

Obsidian v1 still uses one trusted matcher that can decrypt private orders in memory for auction execution. The new proof receipt does not remove that trust assumption; it makes matcher behavior auditable without publishing private order inputs.
