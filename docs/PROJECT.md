# Snake Eye — architecture

## Goal

Take a list of NYSE/NASDAQ symbols, keep only the ones that match a set of user
conditions, and rank what is left so the best fit is at the top. Everything runs in the
browser: no build step, no framework, no dependencies.

## Data flow

```text
 data/stocks.json ──► api.js ──► indicators.js ──► score.js ──► row
                                                                 │
                        criteria (form / URL / preset) ──► filters.js
                                                                 │
                                                          scanner.js ──► table
                                                          stock.js   ──► charts + panels
```

`api.js` loads the raw universe once, runs `indicators.analyze()` over each price
history, attaches the Snake Score, and caches the result. Every other module works on
that shape:

```js
{
  ticker, name, exchange, sector, currency,
  fundamentals: { marketCap, revenue, revenueGrowth, eps, epsGrowth, pe, ps,
                  roe, debtEquity, grossMargin, operatingMargin, currentRatio },
  metrics:      { price, changePercent, volume, avgVolume20, relativeVolume,
                  rsi14, macd, macdSignal, awesomeOscillator, sma20, sma50, sma200,
                  adx, atr14, bbUpper, stochasticK, …, series: { … } },
  score:        { total, label, tone, components: { technical, momentum, volume, fundamental } },
  dates:        ['2025-11-12', …]
}
```

`metrics.series` keeps the full aligned arrays (close, volume, every indicator) so the
charts can plot an indicator against price without re-computing anything.

## Modules

| Module | Responsibility |
|---|---|
| `js/api.js` | Loading, caching, and the single place a real provider would be wired in |
| `js/indicators.js` | Pure indicator maths on number arrays; no DOM, no app types |
| `js/filters.js` | The filter schema, criteria normalisation, matching, URL encoding |
| `js/score.js` | Snake Score sub-scores, weights and the verdict label |
| `js/scanner.js` | Scanner page: form ⇄ criteria, presets, sorting, search, rendering |
| `js/stock.js` | Stock page: header, score breakdown, chart stack, stat panels |
| `js/charts.js` | Canvas renderer plus one helper per panel |
| `js/watchlist.js` | `localStorage` storage API, change notifications across tabs |
| `js/app.js` | Formatters, DOM helpers, shared chrome, landing page behaviour |

### Why a filter schema

Every filter is one entry in `FILTER_FIELDS`:

```js
{ key: 'priceMin', type: 'min', group: 'price', label: 'Min price',
  value: (row) => row.metrics.price }
```

`type` is `min`, `max`, `flag` (checkbox with a `test(row)`) or `set` (the exchange
checkboxes). Because the schema is the single source of truth, the same list drives form
reading and writing, URL encoding and decoding, the active-filter chips, the count of
active filters, and matching. Adding a filter is one entry plus one input whose `name`
matches the key.

### Missing data

A filter on a metric a row cannot supply fails rather than passes. A company with no
positive earnings has `pe: null`, so it is excluded by a "P/E < 20" filter instead of
sneaking through; the same applies to SMA200 before 200 sessions exist. Sorting pushes
missing values to the bottom regardless of direction.

## State

- **Filters** live in the URL, so a scan is shareable and survives a reload.
- **Watchlist** lives in `localStorage` under `snake-eye:watchlist`.
- **Nothing else is persisted**, and nothing is sent anywhere — the app makes no network
  requests beyond fetching its own two JSON files.

## Demo data

`scripts/generate-stocks.mjs` builds `data/stocks.json` from a fixed seed: 72 invented
companies, 220 business days each, geometric random walk with a per-ticker drift and a
slow regime wave, plus a volume catalyst on roughly a third of the universe so that
relative-volume and breakout filters have something to find. Fundamentals are derived
from the final price and a share count, then perturbed.

Regenerate with `node scripts/generate-stocks.mjs`. Same seed, same universe.

**Ticker collisions.** The company names are invented, but four-letter symbols are a small
space: 14 of the 72 demo symbols (WNDR, MORF, VRDN, XYZ, AMPH, IRON, FNGR, CLDR, SWFT,
PYTH, HLIX, NEST, CORA, ABC) also exist as real listings somewhere. The demo record has
nothing to do with the real issuer. Because a footnote was not enough to prevent that
confusion in practice, demo mode now shows a `DEMO` badge in the header of every page and
next to the ticker on the stock page.

## Roadmap

| Stage | Contents | State |
|---|---|---|
| MVP | filters, Snake Score, results, stock page, watchlist | done |
| 2 | price / volume / RSI / MACD / AO charts | done |
| 3 | fundamentals from a real provider | next |
| 4 | backend + live market data (API keys server-side; see `API.md`) | planned |
| 5 | deploy — GitHub Pages first, Vercel once a backend exists | planned |
| 6 | alerts on user conditions | planned |
| 7 | AI scanner: plain-language query → filter criteria | planned |

Stage 7 has a natural seam already: a query parser only has to emit a criteria object,
which `normalizeCriteria()` accepts and the scanner runs unchanged.
