# Vercel Launch Checklist

Primary review surface: the deployed Vercel URL. Judges should not need local scripts, SSH tunnels, or localhost services.

## Required Vercel Environment

Set these in the Vercel project before sharing the link:

```text
NEXT_PUBLIC_CHAIN_ID=421614
NEXT_PUBLIC_WALLETCONNECT_ID=<walletconnect-project-id>
NEXT_PUBLIC_DEX_ADDRESS=<dark-pool-dex-address>
MATCHER_API_URL=https://<public-matcher-api>
```

`MATCHER_API_URL` must be an HTTPS URL. Production Next.js API routes reject non-HTTPS matcher URLs so the deployed app cannot silently point at localhost.

The side-private ABI is a breaking contract change. Before sharing a Vercel link for the side-private product, confirm that the DEX address, generated ABI, matcher DB schema, matcher service, and Vercel env vars were redeployed together.

## Matcher API Requirements

Expose the matcher through a public HTTPS reverse proxy, such as Caddy, Nginx plus Certbot, or an API gateway. The Vercel app proxies matcher reads through its own `/api/*` routes.

Required public endpoints:

```text
GET /health
GET /markets
GET /markets/:pairId/candles?interval=5m&limit=200
GET /batches/recent?limit=20
GET /matches/:id
GET /matches/:id/audit
GET /orders?batchId=<id>
GET /tasks/recent?limit=20
GET /tasks/:id
```

Required protected operator endpoint:

```text
POST /operator/audits/:matchId/verify
```

Public matcher responses must redact side-sensitive data:

- `GET /orders` must not expose BUY/SELL side, encrypted handles, plaintext amounts, or remaining encrypted-leg fields.
- `GET /matches/:id` must use neutral `orderAId`/`orderBId` and must not expose buy/sell-labeled ids.
- `GET /matches/:id/audit` must expose verification status only. It must not expose raw S3 keys, private transcript bodies, decrypted auction inputs, or matcher-only signatures/digests beyond status booleans.
- Market candles must use only settled matches and must not include pending order depth or fabricated volume.
- Task APIs must expose lifecycle metadata only; they must not expose private agent payloads, side, size, price, encrypted handles, idempotency keys, or private execution results.
- The audit verifier route must remain matcher-key protected. It should return only digest/signature/field-check/recompute status, not the raw private transcript or decrypted input orders.

Configure matcher CORS only if browsers will call the matcher directly:

```text
MATCHER_CORS_ORIGINS=https://<vercel-domain>
```

## Deployed Smoke

- Vercel URL loads `/pool`, `/setup`, `/orders`, `/markets`, `/batches`, and `/health`.
- Wallet connect opens and wrong-network UI switches to Arbitrum Sepolia.
- CoFHE browser calls succeed under the deployed COOP/COEP headers.
- `/markets` loads settled candles from matcher data; no fake order book, depth, or fabricated volume is shown.
- `/batches` shows matcher-indexed recent batches.
- `/health` shows matcher role, DB status, index lag, closed batches waiting for match, stuck settlements, and recent worker errors.
- `/health` now also reports confirmation depth, latest confirmed block, reorged-log count, relayer checkpoint summary, and expired leased tasks.
- Setup path works from the deployed URL: faucet, wrap, DEX operator approval, and balance refresh.
- Trade path works from the deployed URL: submit private order, wait for receipt, then see the order in `/orders`.
- A maker or second wallet submits crossing testnet liquidity, the matcher closes/matches/settles, and `/markets` receives a new settled candle.

## V1 Trust Disclosure

Obsidian v1 uses a trusted matcher. In the side-private ABI, public chain calldata and events do not include BUY/SELL side, size, price, or fill amounts. Public observers can still see trader address, pair id, batch id, order ids, tx timing, and match ids. The authorized matcher decrypts submitted order legs to run the auction. Private S3 audit transcripts include the matcher-visible auction inputs so an operator-only verifier can recompute the result; public APIs must expose only redacted verification status. Fraud proofs and decentralized solvers are V2 work.

## Side-Private Deploy Gate

Before marking the Vercel app judge-ready:

- Deploy the new `DarkPoolDEX` ABI on Arbitrum Sepolia.
- Apply matcher migrations through `0004_productive_mephisto.sql` to the production matcher DB.
- Redeploy matcher with the new ABI/schema.
- Redeploy Vercel with the new `NEXT_PUBLIC_DEX_ADDRESS` and generated ABI.
- Complete a Vercel-only smoke: setup, private order submit, matcher close/match/settle, `/orders`, `/batches`, `/markets`, `/health`, and audit proof.
