# Alpha 80 Spec: Dark Pool Market Candles

## Purpose

Show real DEX-style market history without leaking private pre-trade data.

## Source Of Truth

Candles are built from matcher DB `matches` rows where:

- `status = SETTLED`
- `settledAt` exists
- `clearingPriceNum` and `clearingPriceDen` exist
- `baseFilled` and `quoteFilled` exist

In Obsidian pair terminology:

- Pair base token is cash, currently `eUSDC`.
- Pair quote token is the traded asset, such as `eWETH`, `eWBTC`, `eARB`, or `eLINK`.
- `baseFilled` is cash volume.
- `quoteFilled` is asset volume.

## API

```text
GET /markets/:pairId/candles?interval=5m&limit=200
```

Supported intervals:

- `1m`
- `5m`
- `15m`
- `1h`
- `4h`
- `1d`

Response:

```json
{
  "pairId": 2,
  "interval": "5m",
  "candles": [
    {
      "time": 1779631200,
      "open": "1.175",
      "high": "1.2",
      "low": "1.15",
      "close": "1.18",
      "openNum": "1175000000",
      "openDen": "1000000000",
      "volumeCash": "1175",
      "volumeAsset": "1000"
    }
  ]
}
```

## Rules

- Use `settledAt` for the candle timestamp. Fall back to `publishedAt` only in tests or backfilled rows where settlement time is missing.
- Sort trades by timestamp, then match id.
- `open` is the first settled match price in the bucket.
- `high` is the max price in the bucket.
- `low` is the min price in the bucket.
- `close` is the last settled match price in the bucket.
- Volumes are summed raw integer strings. The frontend formats with token decimals.
- Do not include pending, disputed, voided, or unmatched private orders.

## Verification

- Unit test candle grouping.
- Unit test fractional price preservation.
- Unit test filtering out non-settled rows.
- Matcher typecheck and test suite must pass.
