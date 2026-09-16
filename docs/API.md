# Snake Eye — data and API

## Two sources today

1. **Bundled demo file** — `data/stocks.json`, described below.
2. **Interactive Brokers** — `scripts/ibkr-ingest.mjs` writes the same shape into
   `data/stocks.local.json` from a gateway running on your own machine. See
   [IBKR.md](IBKR.md). This is the personal-use path and needs no backend at all.

The rest of this page describes the payload contract both share, and what a hosted
backend would add.

## The bundled file

The MVP reads `data/stocks.json` with `fetch`. Nothing else is requested, and there are
no keys, accounts or third-party calls anywhere in the frontend.

### Payload shape

```jsonc
{
  "meta": {
    "generatedAt": "2026-09-15T00:00:00.000Z",
    "seed": 99540510,
    "bars": 220,
    "firstSession": "2025-11-12",
    "lastSession": "2026-09-15",
    "synthetic": true,
    "notice": "Fictional demo data …"
  },
  "stocks": [
    {
      "ticker": "ABC",
      "name": "Aurora Biocentric Corp",
      "exchange": "NASDAQ",
      "sector": "Healthcare",
      "currency": "USD",
      "fundamentals": {
        "marketCap": 4624107434,
        "sharesOutstanding": 565986222,
        "revenue": 1063200422,
        "revenueGrowth": -0.0039,   // ratio, not percent
        "eps": 0.22,
        "epsGrowth": -0.1018,
        "pe": 37.14,                // null when there are no positive earnings
        "ps": 4.35,
        "roe": 0.0609,
        "debtEquity": 0.13,
        "grossMargin": 0.5362,
        "operatingMargin": 0.1282,
        "currentRatio": 2.64
      },
      "history": {
        "close":  [7.62, 7.36, …],  // oldest first, one entry per session
        "high":   [7.71, 7.44, …],
        "low":    [7.55, 7.28, …],
        "volume": [2387000, 2766000, …]
      }
    }
  ]
}
```

Rules the rest of the app relies on:

- `history` arrays are the same length, oldest first, aligned by index.
- Dates are not stored per bar: `api.js` walks business days back from
  `meta.lastSession`, which keeps the file small.
- Ratios (`revenueGrowth`, `roe`, margins) are ratios, not percentages. Filters that ask
  for a percentage convert in `filters.js`.
- A metric that does not exist is `null`, never `0`.

Indicators are **not** stored: they are computed in the browser from `history`, so the
same file supports any indicator added later without regenerating data.

## Stage 4: live market data

A market data provider needs an API key. A key cannot live in frontend code — everything
shipped to the browser is readable by anyone who loads the page, and a key in a public
repository is a key that is already leaked.

So the frontend never talks to the provider:

```text
Browser (Snake Eye)
   │  GET /api/universe        ← no key, same origin
   ▼
Your backend (Vercel function, small Node service, …)
   │  API key from an environment variable
   ▼
Market data provider
   ▼
NYSE / NASDAQ
```

The backend's job:

1. Hold the key in an environment variable — never in the repository.
2. Call the provider, reshape the response into the payload above.
3. Cache. Quotes do not need to be re-fetched per visitor; a shared cache with a short
   TTL keeps the app inside a free tier and inside rate limits.
4. Enforce its own rate limiting, so a single visitor cannot burn the quota.

### Wiring it in

`js/api.js` has one seam:

```js
const REMOTE_ENDPOINT = null;        // e.g. 'https://snake-eye.example.com/api'
```

Set it and `fetchUniverse()` requests `${REMOTE_ENDPOINT}/universe` instead of the local
file. Nothing else changes: indicators, filters, scoring and every page work on the same
shape.

### Things to decide before going live

- **Delay.** Free tiers are typically 15 minutes delayed, or end-of-day. Say so in the UI
  — a scanner that looks live but is not is worse than one that admits the delay.
- **Universe size.** Thousands of symbols with 220 bars each is tens of megabytes. Send
  a screened list, paginate, or compute indicators server-side.
- **Licensing.** Exchange data redistribution is governed by the provider's terms.
- **Correctness.** Fundamentals differ between providers (TTM vs last fiscal year,
  adjusted vs reported EPS). Pick one and document it.
