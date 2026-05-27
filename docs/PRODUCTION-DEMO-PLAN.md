# Production Demo Plan

This is the plan for the next grant-ready demo slice. It is written to avoid overclaiming: every item below is either already working, newly scripted, or explicitly marked as not shipped yet.

## Current Truth

- Contract order submission works on the current Arbitrum Sepolia deployment, but that deployment is the pre-side-private ABI.
- Local code now contains a breaking side-private redesign where `submitOrder` uses four encrypted order legs and no public side argument. This is not live until the DEX, matcher DB, matcher service, and Vercel app are redeployed together.
- The UI now waits for transaction receipts before showing order success.
- The DEX operator approval check blocks order submission before encryption when the required encrypted token has not approved the DEX.
- Browser/operator matching remains available as a fallback and inspection path.
- Node-side CoFHE encryption works for order seeding.
- CLI operator matching works with the matcher key from `.env`, including decrypt, auction, publish, and settle.
- Autonomous server matching is implemented in the matcher package and passed a daemon-only Arbitrum Sepolia close, publish, S3 audit-log, and settle E2E on 2026-05-22.
- Browser/operator matching remains available as a fallback and inspection path, but the primary grant demo can now use the EC2 matcher daemon.
- The matcher now has an x402-gated agent order API surface: agents can discover capabilities and submit structured BUY/SELL order intents through the server-side CoFHE path. It is implemented, but the current x402 challenge path is not the intended Arbitrum-only alpha payment setup. Keep x402 disabled for judge flow unless an Arbitrum-compatible plain-token facilitator is configured.
- The live Arbitrum Sepolia DEX now has four demo markets: `eUSDC/eWETH`, `eUSDC/eWBTC`, `eUSDC/eARB`, and `eUSDC/eLINK`.
- The EC2 matcher daemon passed a four-market Arbitrum Sepolia E2E on 2026-05-24 after its deployment metadata was updated to include ARB/LINK. Batch `70` is the current clean historical certification for the pre-side-private live deployment: it closed, matched, wrote S3 audit logs, and settled WETH, WBTC, ARB, and LINK matches with corrected base/quote transfer ordering and scaled fractional clearing prices.
- Matcher HTTP now exposes post-settlement market candles from settled match history at `GET /markets/:pairId/candles?interval=5m&limit=200`.
- Matcher HTTP now exposes review health and history endpoints: `GET /health`, `GET /markets`, and `GET /batches/recent`.
- Closed-batch matching now waits for `MATCHER_BATCH_MATCH_DELAY_SEC` and compares indexed DB orders with on-chain `batchOrderCount(batchId)` before matching or marking a batch empty.

## Shippable Demo Flow

1. Trader opens `/setup`, mints mock collateral, wraps it into encrypted tokens, and approves the DEX as operator.
2. Trader opens `/pool` and submits sealed BUY or SELL limit orders.
3. Demo-market script seeds maker liquidity using the deployer wallet:
   - WETH asks around 3150 and 3200 USDC.
   - WETH bid around 3250 USDC.
   - WBTC ask around 65000 USDC.
   - WBTC bid around 66000 USDC.
   - ARB ask around 1.15 USDC and bid around 1.20 USDC.
   - LINK ask around 18.50 USDC and bid around 19.00 USDC.
4. Batch is closed after the timer reaches zero by the EC2 matcher daemon.
5. EC2 matcher daemon decrypts closed batch orders, runs the uniform auction, publishes matches, and writes signed S3 audit logs.
6. EC2 matcher daemon settles matches after the dispute window; traders view `/orders` and encrypted balances after settlement.

Side-private version of this flow:

- The trader still chooses BUY or SELL in the UI.
- The client encodes that intent as four encrypted legs: `baseDeposit`, `quoteDeposit`, `baseRequest`, and `quoteRequest`.
- Public chain events do not include BUY/SELL side.
- Public matcher APIs must show `PRIVATE` or neutral order/match ids, not the matcher-derived side.

## Commands

Run these from the repo root:

```powershell
pnpm demo:market:status
pnpm demo:market:seed
pnpm demo:market:orders
pnpm demo:market:close
pnpm demo:operator 0
pnpm demo:settle
```

For a one-command demo seed that also attempts to close the batch:

```powershell
pnpm demo:market
```

The seed commands are state-changing. They mint mock tokens, approve wrappers, wrap into encrypted tokens, approve DEX operators, and submit testnet orders from `DEPLOYER_PRIVATE_KEY`.

`pnpm demo:market:orders` is state-changing but skips mint/wrap. It closes only an empty close-ready batch, then submits the nine encrypted maker orders quickly into a fresh batch. Use it after the deployer wallet already has wrapped encrypted balances and operator approvals.

`pnpm demo:operator <batchId>` is also state-changing. It uses the same matcher wallet from `DEPLOYER_PRIVATE_KEY`, decrypts active orders for that closed batch, runs the shared auction library, encrypts match transfers, and publishes matches on-chain.

`pnpm demo:settle` settles pending matches after the dispute window has elapsed. It skips matches that are not ready or are already settled.

## Acceptance Gate

- `/pool` shows only live batch state, not fixed fake price/volume numbers.
- `/markets` shows post-settlement OHLCV candles from matcher history, not fabricated prices.
- Public order and match APIs do not expose BUY/SELL side, encrypted handles, plaintext amounts, or buy/sell-labeled match ids.
- `pnpm demo:market:status` prints current batch, open state, close-ready state, order count, next order id, and next match id.
- `pnpm demo:market:seed` submits maker orders without showing UI success until receipts succeed.
- `pnpm demo:market:close` closes the batch only when the current batch window has expired.
- EC2 matcher daemon can decrypt, publish, audit-log, and settle a four-market batch covering WETH, WBTC, ARB, and LINK.
- README and demo docs disclose that v1 uses a trusted matcher.

## Certified Four-Market Run

Batch `70` is the current historical certification run for the pre-side-private live deployment. It supersedes earlier batch `66` and `68` proofs because it includes both transfer-order correction and scaled fractional clearing prices. It must not be represented as proof of the new side-private ABI until the breaking redeploy is complete.

- Batch `70` orders:
  - WETH sell tx `0x13ede758a87149d87cfc6bfb4afc0ab79f9871d5c06aea02f749cd9bd5d1399a`
  - WETH buy tx `0xa1b455d188033c97f645d8662bf649e93368817cc261b16e3ee5f8f29c83a836`
  - WBTC sell tx `0x9e8d917547b12b75c85fb8aa2e2884fededa148490bfc7304f547ad649e2d4f9`
  - WBTC buy tx `0xd99f2aced82610706c27213297cb4e90f4fa4e99350d34f2ca3bcf0434955ae8`
  - ARB sell tx `0xfb077af81643ceaee87b425d502b7f463769197e63ae0015ee0f88b44a8f2ceb`
  - ARB buy tx `0x3445ed9e03c1e8b508683a1ed9acc16559af0edff3f70fa4ce9f9af0cdbb916f`
  - LINK sell tx `0x0ec120e008851f016bbb9e8e8817e9530c208a07b532695d88de794ff6133938`
  - LINK buy tx `0x08b098737acffd9920d362893a872417eecfcea3de7d937fb3adc115583cabfc`
- Match `25` WETH: clearing `3200`, publish `0xc54351dfd9c5b25adca9236335243e03698cd385cdec2aabb733c9d28aa8d583`, settle `0x52214523f0d097ae06b239c5a48b5c7990c0db1cd205b3b44dbb0481a7e6fda0`, audit `pair-0/batch-70/match-25.json`
- Match `26` WBTC: clearing `65500`, publish `0xf64d654d3ac839bb617d6f0d8701ba853e419b890584ecdf0496f0a47c51b3c8`, settle `0xc93a272c26e6a3283e1ae56ebd3b0112bdb7f1eef57605321735e94c6dd3a7e3`, audit `pair-1/batch-70/match-26.json`
- Match `27` ARB: clearing `1.175`, publish `0x5aaa23ce852a64b042ca3a06c09e0a50cd07714ef423d43f220697ad39f298dd`, settle `0x9bc92d456d5404c2eef70c8780d36b7482b596215438f1938fe1142a9dac5be3`, audit `pair-2/batch-70/match-27.json`
- Match `28` LINK: clearing `18.75`, publish `0x297d37e030fa9be3162972b11761c4ba430fa072a5a7e7b76ccc5af201a8c04e`, settle `0xc455a582f52f5e020bb5175a195089c8a499d77c8db61ebda9614fb0045275f9`, audit `pair-3/batch-70/match-28.json`

## Maker Bot Live ARB Run

Batch `75` is the first live maker-bot-created candle proof.

- SELL order `75`: tx `0x36bc6c180211696a622ce9f499f00328603def7c9f22816f0a2dd1641833fd6a`, planned at `1.169007` USDC/ARB.
- BUY order `76`: tx `0x779c661747b7b23e46c1667557dd168fc5c831720ae42b4edf44ae9b22ff92ba`, planned at `1.18017` USDC/ARB.
- Match `29` ARB: clearing `1.17458847`, publish `0x45e23c8cbec0b0b50ea841b6caaea899e0d6c1f103d11a335e925ed9ec9cdfb6`, settle `0x588322ebddc342e3f29f310b238147377d161b19a0e8b4a3048eaf909cd151df`, audit `pair-2/batch-75/match-29.json`.

Historical proof retained for context:

- Batch `66` close tx: `0x44d2e580e96902439e3827dc16779750f101f15cee90f0a23b6ff5946792f269`
- Match `17` WETH: publish `0x7c6e8a9b26dfbc724a0e91847c9c43609b163ae9b4fc62c3804df17bacb58edb`, settle `0x77bd82c071b481cfeed600b30a99f41546a1c389829b8d49d0fce98883b3b1c2`, audit `pair-0/batch-66/match-17.json`
- Match `18` WBTC: publish `0x69f0070f43b926daee122870ea509f5f8c5e8bc970408310c2e48fc3e9c9fd5d`, settle `0x61bb8aee37565f1570734022be7be7033ec7472ef12263fcd5d8ef5fea25b7c0`, audit `pair-1/batch-66/match-18.json`
- Match `19` ARB: publish `0xbfef4576ca6c961a578feeb4283ab84287426c2cf6474a0af085b7272562f3cf`, settle `0x1cc54681d3bfc02b3fd2cd746e1c21e1e5116f7ff080b624651e8284dffcd240`, audit `pair-2/batch-66/match-19.json`
- Match `20` LINK: publish `0x045d31bbfefd496b84ccd9691ca6a9ebc569ac58e4a73e1b22e322789a3f393a`, settle `0xa9fa8c35e15f355e2e3fed1cbc8864344b86ca9455a53167b5ade1ceeed7609a`, audit `pair-3/batch-66/match-20.json`

## Roadmap After This Slice

- Complete side-private redeploy:
  - Deploy the new DEX ABI.
  - Apply matcher DB migration `0001_flaky_colossus.sql`.
  - Redeploy matcher and Vercel together.
  - Run a Vercel-only side-private smoke and record fresh tx hashes.
- Harden the x402 agent path:
  - Keep x402 disabled for judge flow unless an Arbitrum-compatible plain-token facilitator is configured.
  - Configure x402 receiver and delegated trader wallets in the deployed matcher environment only after the facilitator decision is settled.
  - Add persisted idempotency for `clientOrderId`.
  - Add per-agent delegated wallets or session-key policy before any paid alpha.
  - Mark indexed orders as agent-originated without exposing private amounts.
- Add deeper truthful market-quality metrics only after they are computed from indexed on-chain events.
- Contract-level batch rotation is manual in v1. A batch with an elapsed timer still accepts orders until `closeBatch` is mined; the UI and CLI surface this as "Close Ready" instead of hiding it.
