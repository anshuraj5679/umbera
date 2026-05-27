# Live Demo Checklist

Use this as the acceptance gate before showing Obsidian to grant reviewers, Fhenix, or users.

## Environment

- Node 22.x is active.
- `.env` has Arbitrum Sepolia RPC, WS RPC, matcher private key, and frontend public env values.
- `shared/addresses/.deployed-arbSepolia.json` matches the current deployment.
- Wallet has Arbitrum Sepolia ETH for gas.

## Trader Path

- Open `/setup`.
- Connect wallet on Arbitrum Sepolia.
- Faucet at least two plain tokens.
- Wrap:
  - BUY wallet wraps `mUSDC -> eUSDC`.
  - SELL wallet wraps `mWETH -> eWETH` or `mWBTC -> eWBTC`.
- Set DEX operator approval for the encrypted token.
- Open `/pool`.
- Submit a BUY order:
  - Pair: `eUSDC/eWETH`
  - Size: asset amount, e.g. `0.1 WETH`
  - Max price: cash per asset, e.g. `3200 USDC/WETH`
- Submit a SELL order from a second wallet:
  - Same asset size
  - Min price below buyer max, e.g. `3000 USDC/WETH`
- Open `/orders` and confirm each order appears.

## Batch Path

- Optional maker seeding path:
  - Run `pnpm demo:market:status` to inspect the live batch.
  - Run `pnpm demo:market:seed` to add scripted maker orders from the deployer wallet.
  - Run `pnpm demo:market:orders` when balances/operators are already prepared and you need fast same-batch maker orders.
  - Run `pnpm demo:market:close` after the timer reaches zero.
- Wait until the batch timer reaches zero.
- Let the EC2 matcher daemon close the batch, decrypt active orders, run the auction, publish matches, and write S3 audit logs.
- Use `/operator` only as a fallback or inspection surface.

## Settlement Path

- Wait for the dispute window or use a short dispute window in a dedicated demo deployment.
- Settle the match.
- Refresh encrypted balances.
- Confirm:
  - Buyer receives encrypted asset.
  - Seller receives encrypted cash.
  - No private amounts appeared in public events.

## Demo Failure Policy

The server matcher is the primary demo path after the 2026-05-22 Arbitrum Sepolia E2E. If EC2, RPC, or the CoFHE threshold network is degraded during a live demo, present the browser operator console as the fallback and say so explicitly.
