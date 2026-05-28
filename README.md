# Dark Pool DEX

Encrypted batch-auction DEX on Fhenix CoFHE. Arbitrum Sepolia target.

Current privacy posture:
- Browser and matcher encryption/decryption use `@cofhe/sdk`.
- `decryptForView` is permit-backed for readable values; `decryptForTx` helpers are wired for transaction-bound decrypt results.
- The matcher decrypts order legs only in memory for auction execution. The order database stores ciphertext handles and public lifecycle metadata, not plaintext side, size, limit price, or remaining amounts.

See `docs/superpowers/specs/2026-05-16-darkpool-dex-v1-design.md` for design,
`docs/superpowers/plans/2026-05-16-darkpool-dex-v1.md` for plan,
`docs/PRODUCT-SPEC.md` for product direction,
`docs/PRODUCTION-DEMO-PLAN.md` for the current grant-demo execution plan,
`docs/MARKET-READY-IMPLEMENTATION-PLAN.md` for the next alpha implementation plan,
`docs/relayer-LEVEL-UPGRADE-PLAN.md` for the production-grade architecture upgrade path,
`docs/VERCEL-LAUNCH-CHECKLIST.md` for the deployed judge-review checklist,
`docs/PRODUCTION-80-ROADMAP.md` for the 70-80% alpha roadmap,
`docs/ALPHA-80-AGENT-SPEC.md` for maker, audit, API, and ops agent specs,
`docs/X402-AGENT-API.md` for the autonomous agent order entry point,
`docs/LIVE-DEMO-CHECKLIST.md` for the grant-demo path,
`docs/RUNBOOK.md` for ops.

## Quick start

    cp .env.example .env
    pnpm install
    pnpm -F contracts build
    pnpm -F matcher dev
    pnpm -F frontend dev

## Demo market

The production-demo path keeps the browser operator console and CLI operator as
fallback tools. The EC2 server matcher has now completed a daemon-only Arbitrum
Sepolia close, match, audit-log, and settlement run.

    pnpm demo:market:status
    pnpm demo:market:seed
    pnpm demo:market:orders
pnpm demo:market:close
pnpm demo:operator 0
pnpm demo:settle

## Maker bot dry-run

The maker bot runner plans bounded demo liquidity without submitting transactions:

    npm --prefix matcher run maker:dry-run -- --seed demo-smoke --max-orders 8

Live submission is guarded behind the explicit `maker:execute` script and uses the encrypted agent order path.

## Vercel review

The deployed app must use a public HTTPS matcher API:

```text
MATCHER_API_URL=https://<public-matcher-api>
NEXT_PUBLIC_CHAIN_ID=421614
NEXT_PUBLIC_DEX_ADDRESS=<dark-pool-dex-address>
NEXT_PUBLIC_WALLETCONNECT_ID=<walletconnect-project-id>
```

See `docs/VERCEL-LAUNCH-CHECKLIST.md` before sharing the Vercel link.
