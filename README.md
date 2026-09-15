<p align="center">
  <img src="assets/images/logo/snake-eye-logo.jpg" alt="Snake Eye" width="280" />
</p>

<h1 align="center">🐍👁️ Snake Eye — Stock Market Scanner</h1>

<p align="center"><strong>See the market. Find the target.</strong></p>

Snake Eye filters a NYSE/NASDAQ-style universe by price, volume, fundamentals and
technical indicators, then ranks whatever survives the filters with a single 0–100
**Snake Score**.

It is a static frontend — plain HTML, CSS and ES modules, no build step and no
dependencies — so it runs anywhere a folder can be served, GitHub Pages included.

---

## Screenshots

### Landing page — quick scan and today's strongest setups

![Snake Eye landing page](docs/screenshots/home.jpg)

### Scanner — filters on the left, ranked results on the right

Running the **Snake Hunt** preset: price $2–30, average volume over 500K, relative
volume over 1.5, RSI 40–70, MACD bullish, AO positive, price above SMA50.

![Snake Eye scanner](docs/screenshots/scanner.jpg)

### Stock page — Snake Score breakdown and the chart stack

![Snake Eye stock page](docs/screenshots/stock.jpg)

---

## Status

This is the **MVP** described in the project plan, plus the Stage 2 charts:

| Feature | State |
|---|---|
| Landing page with quick scan | ✅ |
| Scanner: exchange, price, volume filters | ✅ |
| Scanner: 12 fundamental filters | ✅ |
| Scanner: 13 technical indicators | ✅ |
| Snake Score (4 weighted sub-scores) | ✅ |
| Sortable, searchable results table | ✅ |
| Stock page with price / volume / RSI / MACD / AO charts | ✅ |
| Watchlist in `localStorage` | ✅ |
| Saved strategies (presets) | ✅ |
| Responsive design | ✅ |
| Real market data + backend | ⏳ Stage 4 |
| Alerts, AI scanner | ⏳ Stage 6–7 |

**The data in this build is synthetic.** `data/stocks.json` holds 72 invented tickers
with 220 generated sessions each, produced by `scripts/generate-stocks.mjs`. No ticker
here maps to a real company — that is deliberate, so nothing in the UI can be mistaken
for real market data.

---

## Run it

The app loads `data/stocks.json` with `fetch`, so it needs a web server — opening
`index.html` straight from the file system will not work.

```bash
# any static server will do
npx http-server -p 8080 -c-1 .
# then open http://localhost:8080
```

Regenerate the demo universe (deterministic, same seed → same data):

```bash
node scripts/generate-stocks.mjs
```

Deploy: push to GitHub and enable Pages on the branch root. There is nothing to build.

---

## Project structure

```text
snake-eye/
├── index.html              landing page + quick scan
├── pages/
│   ├── scanner.html        the main workspace
│   ├── stock.html          single symbol: charts, indicators, fundamentals
│   ├── watchlist.html      saved symbols
│   └── settings.html       data source, storage, roadmap
├── css/
│   ├── style.css           design tokens, chrome, shared components
│   ├── dashboard.css       landing page
│   ├── scanner.css         scanner + results table
│   ├── stock.css           stock page, watchlist cards
│   └── responsive.css      every breakpoint, in one place
├── js/
│   ├── app.js              formatters, DOM helpers, shared chrome, home page
│   ├── api.js              data access + the seam for a real provider
│   ├── indicators.js       SMA, EMA, RSI, MACD, AO, ADX, ATR, Bollinger, Stochastic
│   ├── filters.js          filter schema + matching
│   ├── score.js            Snake Score
│   ├── scanner.js          scanner page controller
│   ├── stock.js            stock page controller
│   ├── charts.js           canvas charts
│   ├── watchlist.js        localStorage watchlist
│   ├── watchlist-page.js   watchlist page controller
│   └── settings.js         settings page controller
├── data/
│   ├── stocks.json         generated demo universe
│   └── presets.json        saved strategies
├── scripts/
│   └── generate-stocks.mjs the data generator
└── docs/
    ├── PROJECT.md          architecture and data flow
    ├── API.md              data contract and the road to live data
    └── INDICATORS.md       how each indicator is computed
```

The plan's file list also mentioned `js/app.js` covering the home page; the two extra
files here (`js/stock.js`, `js/watchlist-page.js`) keep each page's controller next to
the page it drives instead of piling everything into `app.js`.

---

## How a scan works

```text
data/stocks.json
      ↓  api.js       load + cache
indicators.js         SMA · EMA · RSI · MACD · AO · ADX · ATR · BB · Stochastic
      ↓
score.js              technical 40% · momentum 25% · volume 20% · fundamental 15%
      ↓
filters.js            every active criterion must pass
      ↓
scanner.js            sort → search → render
```

Every filter is declared once in `js/filters.js`. The form, the URL query string, the
presets and the matching logic all read that one schema, so adding a filter means
adding a field there plus an input whose `name` matches the key.

Scans are shareable: the scanner keeps its filters in the URL
(`pages/scanner.html?priceMin=2&priceMax=30&macdBullish=1`), and `?preset=breakout`
loads a saved strategy directly.

---

## Snake Score

Four sub-scores, each 0–100, weighted into one number:

| Sub-score | Weight | What it reads |
|---|---:|---|
| Technical | 40% | price vs SMA20/50/200, MA stacking, ADX, position in the Bollinger range |
| Momentum | 25% | MACD vs signal, histogram direction, AO level and direction, RSI band |
| Volume | 20% | relative volume, liquidity, volume vs the 50-day average |
| Fundamental | 15% | revenue growth, EPS, EPS growth, P/E, ROE, debt/equity |

Checks are graded rather than pass/fail wherever a metric is continuous — ADX 39 scores
higher than ADX 21 instead of both simply clearing a threshold. The stock page shows the
full breakdown, line by line. Weights live in `js/score.js`.

---

## Important

Snake Eye is an analysis and filtering tool. **The Snake Score measures how well a stock
matches the selected criteria — it is not a price forecast, not a guarantee, and not
investment advice.** Any real deployment also has to account for market data delay, data
quality, exchange licensing rules, and trading fees and risk.

---

## О проекте

**Snake Eye** — веб-приложение для поиска акций NYSE/NASDAQ по цене, объёму, финансовым
показателям и техническим индикаторам. Это MVP из плана проекта: главная страница,
сканер со всеми фильтрами, Snake Score, таблица результатов, страница акции с графиками
и watchlist в `localStorage`.

Данные в этой версии — сгенерированные демонстрационные (`data/stocks.json`), реальные
тикеры не используются. `Snake Score` — внутренняя оценка соответствия заданным
критериям, а не прогноз цены и не инвестиционная рекомендация.

## License

MIT — see [LICENSE](LICENSE).
