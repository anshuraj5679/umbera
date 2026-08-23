# x402 Agent Access API

This slice makes x402 useful for autonomous trading agents, not just for a paywall.

The matcher service exposes a paid access endpoint. x402 settlement returns a short-lived bearer capability, and the separate order endpoint uses that capability to submit encrypted account-commitment orders.

The x402 payment is only the access/payment layer. It must not be used as the dark-pool settlement token and must not encode trade direction, size, or price on-chain. The DEX order itself is submitted as four encrypted token legs against a `sessionAccountCommitment`.

## Architecture

- API host: matcher Express service.
- Payment rail: x402 over HTTP.
- Current x402 challenge-test network: Base Sepolia, `eip155:84532`, through `https://x402.org/facilitator`.
- DEX execution network: Arbitrum Sepolia, `421614`.
- Default enabled DEX pairs: `0` `eUSDC/eWETH`, `1` `eUSDC/eWBTC`, `2` `eUSDC/eARB`, `3` `eUSDC/eLINK`.
- Trade signer: `AGENT_TRADER_PRIVATE_KEY`, separate from `MATCHER_PRIVATE_KEY`.
- Access token: opaque HMAC bearer token; the database stores only its hash, expiry, scope, and usage count.
- DEX token setup: the delegated trader must hold wrapped encrypted balances. The API auto-sets DEX operator approval on both encrypted wrappers for the selected pair when missing.

The free x402.org facilitator is useful only for the current challenge E2E. It is not the intended alpha privacy path because the Umbra DEX deployment is on Arbitrum Sepolia. For a real Arbitrum-only agent flow, keep x402 disabled until an Arbitrum-compatible facilitator is configured, or run a custom facilitator for plain Arbitrum payment tokens.

## Routes

### `GET /agent/capabilities`

Public discovery route for agents. It returns:

- DEX chain and address.
- Supported pairs and sides.
- x402 price/network/facilitator metadata.
- Whether the delegated trader is configured.
- Risk limits.
- Expected order request shape.

### `POST /agent/access`

Paid route when `X402_AGENT_ENABLED=true`; dev-bypass route when `AGENT_ORDER_DEV_BYPASS_TOKEN` is configured.

Response:

```json
{
  "ok": true,
  "accessToken": "obsat_...",
  "tokenType": "Bearer",
  "scope": "agent:order",
  "chainId": 421614,
  "dexAddress": "0x...",
  "expiresAt": "2026-05-31T12:00:00.000Z",
  "maxUses": 1
}
```

### `POST /agent/orders`

Requires `Authorization: Bearer <accessToken>`.

Request body:

```json
{
  "pairId": 0,
  "side": "BUY",
  "size": "0.5",
  "limitPrice": "3200",
  "expiryHours": 24,
  "clientOrderId": "agent-run-001",
  "agent": "demo-agent",
  "sessionAccountCommitment": "0x..."
}
```

Response body after successful DEX submission:

```json
{
  "ok": true,
  "taskId": "5b85972f-45e7-4d4a-84c7-1cb2c1dbf0b5",
  "txHash": "0x...",
  "orderId": "123",
  "batchId": "57",
  "pairId": 0,
  "accountCommitment": "0x...",
  "expiry": "1770000000",
  "accessMode": "bearer-capability",
  "replayed": false
}
```

The response does not echo order side, sizing, token direction, decrypted amounts, or payment identity.

`clientOrderId` is now used as an idempotency key for agent submissions. A completed duplicate returns the original task/result with `replayed: true`; an in-flight duplicate returns a task conflict instead of submitting a second DEX order.

On-chain DEX calldata and events do not include public side. Public observers can see an account commitment submitted an order for a pair and batch, but they cannot distinguish BUY from SELL from the DEX event or settlement token-flow shape. x402 payment remains public, but it is no longer stored with order payloads.

## Environment

```dotenv
X402_AGENT_ENABLED=false
X402_AGENT_FACILITATOR_URL=https://x402.org/facilitator
X402_AGENT_NETWORK=eip155:84532
X402_AGENT_PRICE=$0.01
X402_AGENT_PAY_TO=0xReceiver
X402_AGENT_RESOURCE_URL=https://umbra-darkpool.vercel.app/api/agent/access
X402_AGENT_SYNC_FACILITATOR_ON_START=true
AGENT_ACCESS_TOKEN_SECRET=replace-with-long-random-secret
AGENT_ACCESS_TOKEN_TTL_SEC=600
AGENT_ACCESS_MAX_USES=1

AGENT_TRADER_PRIVATE_KEY=0x...
AGENT_ORDER_ALLOWED_PAIR_IDS=0,1,2,3
AGENT_ORDER_MAX_NOTIONAL_USDC=10000
AGENT_ORDER_MAX_EXPIRY_HOURS=24
```

Set `X402_AGENT_RESOURCE_URL` on deployed matcher instances when requests reach the matcher through the Vercel proxy. This keeps the `PAYMENT-REQUIRED` resource URL on the public HTTPS endpoint that agents actually call.

For local non-x402 testing only:

```dotenv
AGENT_ORDER_DEV_BYPASS_TOKEN=replace-with-long-random-token
```

Then call:

```powershell
curl -X POST http://localhost:8080/agent/orders `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer <access-token>" `
  -d '{"pairId":0,"side":"BUY","size":"0.5","limitPrice":"3200","sessionAccountCommitment":"0x..."}'
```

If neither x402 nor the bypass token is configured, `POST /agent/access` returns `503` and no order token can be minted.

## Current Limits

- This does not require a custom SDK yet. Agents can use x402-compatible HTTP clients directly against `/agent/capabilities` and `/agent/orders`.
- A future SDK is useful when third-party agents need typed helpers, policy simulation, retries, and idempotency handling.
- This demo uses one delegated trader hot wallet. Market alpha should move to per-agent delegated wallets, session keys, or account-abstraction policies.
- Agent-order idempotency is persisted through the matcher task ledger. Broader task-backed retry and reconciliation still need to be applied to close, match, publish, settle, and audit workflows.
- x402 verification happens before access-token issuance. The DEX order route only accepts the short-lived bearer capability returned by `/agent/access`.
- If x402 is moved fully onto Arbitrum Sepolia with a custom facilitator, keep the payment token public/plain and separate from encrypted trading balances. Do not use `eUSDC`, `eWETH`, or other encrypted wrappers as x402 payment tokens.
- Public matcher APIs and public audit artifacts must not expose agent-request side. Side appears only in the private agent request and trusted matcher memory during auction execution.

## E2E Checks

Dev-bypass order E2E. This starts a local ephemeral HTTP server, calls the real `/agent/orders` route, encrypts with CoFHE, and submits a tiny Arbitrum Sepolia order:

```powershell
npm --prefix matcher run e2e:agent-order
```

x402 challenge E2E. This starts the paid route with x402 enabled and verifies unpaid agent access receives HTTP `402` plus the official `PAYMENT-REQUIRED` header:

```powershell
npm --prefix matcher run e2e:x402-challenge
```

Full paid x402 settlement needs a funded x402 payer wallet and a configured `X402_AGENT_PAY_TO`. Do not treat the challenge E2E as a completed paid settlement.
