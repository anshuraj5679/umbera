# Audit Checklist (v1)

Each row links a concern from `ARCHITECTURE.md` §8 to its test or an explicit "N/A v1" note.

| Concern | Mitigation | Test / Note |
|---|---|---|
| MEV / front-running | encrypted side/amount ciphertexts, batch auction | Partially covered by encrypted `submitOrder` e2e; event metadata and public API redaction tests still need broader coverage |
| Sandwich | single clearing price | `auction.test.ts::midpoint_within_batch` |
| Malicious matcher (oversize) | FHE.select zero-out in `_publishSingleMatch` | Not covered by a real assertion yet; `OversizedTransfer.t.sol` is placeholder |
| Reentrancy on settle | nonReentrant + state-first writes | Placeholder Foundry test only; needs malicious token harness |
| Stale order griefing | expiry rejection | Not covered yet |
| Fee manipulation | `MAX_FEE = 100 bps` | `feeRate_aboveMax_reverts` |
| Metadata leakage | events omit side/amounts; public APIs redact side-sensitive DB fields | Partially covered by `SubmitOrder.e2e.test.ts` side check and `server.test.ts` API redaction checks; more event/API coverage needed |
| Operator expiry | token-side enforced | `SubmitOrder.e2e.test.ts::rejects submitOrder when the operator deadline is in the past` |
| DoS via batch fill | `maxOrdersPerBatch` | Not covered yet |
| Admin lockout | two-step transfer | `admin_transfer_two_step` |
| Matcher key compromise | `setMatcher` admin path | RUNBOOK §key-rotation |
