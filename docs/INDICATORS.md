# Snake Eye — indicator reference

All indicator maths lives in `js/indicators.js`. Every function takes plain number
arrays (oldest first) and returns an array of the same length, padded at the front with
`null` where there is not enough history yet. Keeping the arrays aligned with the input
means charts can plot an indicator against price with no index bookkeeping, and the last
element is always "today".

`analyze(history)` runs the whole set once and returns the flat snapshot the scanner,
filters and Snake Score read, with the full series kept under `.series`.

---

## Moving averages

**SMA(n)** — arithmetic mean of the last `n` closes, computed with a rolling sum.

**EMA(n)** — exponential moving average, `k = 2 / (n + 1)`, seeded with the SMA of the
first `n` values so the series does not depend on how much history was loaded.

Periods used: 20, 50, 200 for both.

## RSI (14)

Wilder's Relative Strength Index. Gains and losses are split per bar, each smoothed with
Wilder's method (`prev * (n-1) + current) / n`, then:

```text
RSI = 100 − 100 / (1 + avgGain / avgLoss)
```

A window with no losses has no defined ratio, so RSI is reported as 100 by definition.

Read as: above 70 overbought, below 30 oversold, 40–70 the band Snake Eye treats as
healthy for a continuation setup.

## MACD (12, 26, 9)

```text
MACD line = EMA12 − EMA26
Signal    = EMA9 of the MACD line
Histogram = MACD line − Signal
```

The signal EMA is seeded from the MACD line's own first valid value, so it starts where
the MACD line starts rather than at bar 0.

- `macdBullish` — MACD line above the signal line.
- `macdCross` — the histogram turned positive on the most recent bar (a fresh cross).

## Awesome Oscillator

```text
median  = (high + low) / 2
AO      = SMA5(median) − SMA34(median)
```

Positive means the short-term median price is above the longer-term one. The chart
colours each bar by whether it is higher than the previous bar, which is the usual
reading for AO momentum; `aoRising` uses the same comparison.

## ADX (14) with +DI / −DI

Directional movement, smoothed Wilder-style:

```text
+DM = up move   when it exceeds the down move and is positive, else 0
−DM = down move when it exceeds the up move and is positive, else 0
TR  = max(high−low, |high−prevClose|, |low−prevClose|)

+DI = 100 × smoothed(+DM) / smoothed(TR)
−DI = 100 × smoothed(−DM) / smoothed(TR)
DX  = 100 × |+DI − −DI| / (+DI + −DI)
ADX = smoothed(DX)
```

ADX measures trend *strength*, not direction: below 20 is a drift, above 25 a trend,
above 40 a strong one. The Snake Score ramps its credit from 18 to 40 rather than using
a single threshold.

## ATR (14)

Wilder's average of the true range. Reported both in price terms and as
`atrPercent = ATR / price × 100`, which is what the scanner filters on — a $1 range means
something different on a $4 stock than on a $400 one.

## Bollinger Bands (20, 2)

```text
middle    = SMA20
upper     = middle + 2σ        σ = population standard deviation over the same window
lower     = middle − 2σ
%B        = (close − lower) / (upper − lower)
bandwidth = (upper − lower) / middle
```

`%B` above 1 means the close is outside the upper band — that is what the
"close above upper Bollinger Band" filter tests.

## Stochastic (14, 3)

```text
%K = 100 × (close − lowest low) / (highest high − lowest low)   over 14 bars
%D = SMA3 of %K
```

A flat window (highest equals lowest) reports 50 rather than dividing by zero.

---

## Derived values

| Field | Definition |
|---|---|
| `changePercent` | close vs the previous close |
| `avgVolume20` / `avgVolume50` | average volume over the previous 20 / 50 sessions, **excluding today** |
| `relativeVolume` | today's volume ÷ `avgVolume20` |
| `high52w` / `low52w` | extremes of the last 252 sessions available |
| `percentOf52wHigh` | close ÷ 52-week high × 100 — how close to the high the stock is trading |

Excluding today from the volume averages matters: if today were inside the window, a
volume spike would inflate its own baseline and relative volume would understate it.

## Verification

RSI is checked against Wilder's published worked example (the classic 33-bar series) in
development; SMA and EMA are checked against hand-computed windows. If you change any of
this maths, re-run those spot checks — indicators are the layer where a silent error
propagates into every filter and every score.
