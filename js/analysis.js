/**
 * Snake Eye — the case for and against, in words.
 *
 * Every sentence is derived from a number already on the page: each rule below
 * checks one condition and, when it holds, says what it is and why it matters.
 * Rules carry a weight; each side keeps its strongest five and opens with a
 * one-line verdict, so the reader gets six sentences at most per side. A side
 * with fewer than four points is topped up with the levels that would change
 * the picture, so a weak case still reads as five sentences, not two.
 *
 * Pure — no DOM — so tests/analysis.test.mjs can drive it with plain rows.
 * It describes the setup. It does not predict the price and is not advice.
 */

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const price = (value) => `$${value.toFixed(value < 1 ? 3 : 2)}`;
const pct = (value, digits = 0) => `${value.toFixed(digits)}%`;
const ratioPct = (value) => `${(value * 100).toFixed(0)}%`;
const gap = (a, b) => ((a - b) / b) * 100;

const MAX_POINTS = 5;

/** Rules that argue for owning it. Each returns a sentence or null. */
const BULL = [
  [10, ({ m }) => isNum(m.sma20) && isNum(m.sma50) && isNum(m.sma200) && m.sma20 > m.sma50 && m.sma50 > m.sma200
    ? 'The 20-, 50- and 200-day averages are stacked in bullish order — the textbook shape of an established uptrend.'
    : null],
  [9, ({ m }) => isNum(m.sma200) && m.price > m.sma200
    ? `Price is ${pct(gap(m.price, m.sma200))} above its 200-day average (${price(m.sma200)}), so the long-term trend points up.`
    : null],
  [7, ({ m }) => isNum(m.sma50) && isNum(m.sma20) && m.price > m.sma20 && m.price > m.sma50
    ? `It also holds above both the 20-day (${price(m.sma20)}) and the 50-day (${price(m.sma50)}) averages, so the short and medium trends agree.`
    : null],
  [8, ({ m }) => isNum(m.macd) && isNum(m.macdSignal) && m.macd > m.macdSignal
    ? `MACD is above its signal line${isNum(m.macdHistogram) && isNum(m.macdHistogramPrev) && m.macdHistogram > m.macdHistogramPrev ? ' and the gap is widening' : ''}, which says momentum is on the buyers' side.`
    : null],
  [6, ({ m }) => isNum(m.awesomeOscillator) && m.awesomeOscillator > 0 && isNum(m.awesomeOscillatorPrev) && m.awesomeOscillator > m.awesomeOscillatorPrev
    ? 'The Awesome Oscillator is positive and rising, confirming momentum from a second angle.'
    : null],
  [7, ({ m }) => isNum(m.rsi14) && m.rsi14 >= 45 && m.rsi14 <= 65
    ? `RSI at ${m.rsi14.toFixed(0)} sits in the healthy band — strong enough to trend, with room left before it is overbought.`
    : null],
  [6, ({ m }) => isNum(m.rsi14) && m.rsi14 < 30
    ? `RSI at ${m.rsi14.toFixed(0)} is oversold; selling this one-sided often exhausts itself and invites a rebound.`
    : null],
  [8, ({ m }) => isNum(m.adx) && m.adx >= 25 && isNum(m.plusDI) && isNum(m.minusDI) && m.plusDI > m.minusDI
    ? `ADX at ${m.adx.toFixed(0)} with +DI above -DI means the up-move has real directional strength, not just drift.`
    : null],
  [7, ({ m }) => isNum(m.relativeVolume) && m.relativeVolume >= 1.5 && isNum(m.changePercent) && m.changePercent > 0
    ? `Today's gain came on ${m.relativeVolume.toFixed(1)}x normal volume — buyers are showing up in size.`
    : null],
  [6, ({ m }) => isNum(m.percentOf52wHigh) && m.percentOf52wHigh >= 95
    ? `At ${pct(m.percentOf52wHigh)} of its 52-week high (${price(m.high52w)}), there is little overhead supply from holders waiting to break even.`
    : null],
  [4, ({ m }) => isNum(m.stochasticK) && isNum(m.stochasticD) && m.stochasticK > m.stochasticD && m.stochasticK < 30
    ? 'The stochastic has turned up from oversold territory, an early sign of a bounce.'
    : null],
  [7, ({ f }) => isNum(f.revenueGrowth) && f.revenueGrowth >= 0.1
    ? `Revenue grew ${ratioPct(f.revenueGrowth)} in the last fiscal year, so the business behind the chart is expanding.`
    : null],
  [6, ({ f }) => isNum(f.eps) && f.eps > 0 && isNum(f.pe) && f.pe > 0 && f.pe < 18
    ? `It is profitable and priced at ${f.pe.toFixed(1)} times earnings, which is modest.`
    : null],
  [5, ({ f }) => isNum(f.roe) && f.roe >= 0.15
    ? `Return on equity of ${ratioPct(f.roe)} shows the company earns well on its capital.`
    : null],
  [4, ({ f }) => isNum(f.debtEquity) && f.debtEquity >= 0 && f.debtEquity < 0.5
    ? `Debt is light (${f.debtEquity.toFixed(2)} times equity), which leaves room to absorb a bad year.`
    : null],
];

/** Rules that argue against it. */
const BEAR = [
  [10, ({ m }) => isNum(m.sma20) && isNum(m.sma50) && isNum(m.sma200) && m.sma20 < m.sma50 && m.sma50 < m.sma200
    ? 'The 20-, 50- and 200-day averages are stacked in bearish order — the shape of an established downtrend.'
    : null],
  [9, ({ m }) => isNum(m.sma200) && m.price < m.sma200
    ? `Price is ${pct(-gap(m.price, m.sma200))} below its 200-day average (${price(m.sma200)}): the long-term trend is still down.`
    : null],
  [6, ({ m }) => isNum(m.sma50) && m.price < m.sma50
    ? `It trades under its 50-day average (${price(m.sma50)}), which tends to act as resistance on rallies.`
    : null],
  [8, ({ m }) => isNum(m.macd) && isNum(m.macdSignal) && m.macd < m.macdSignal
    ? 'MACD is below its signal line, so short-term momentum is with the sellers.'
    : null],
  [5, ({ m }) => isNum(m.macd) && isNum(m.macdSignal) && m.macd > m.macdSignal && isNum(m.macdHistogram) && isNum(m.macdHistogramPrev) && m.macdHistogram < m.macdHistogramPrev
    ? 'MACD is still above its signal, but the histogram is shrinking — momentum is fading.'
    : null],
  [6, ({ m }) => isNum(m.awesomeOscillator) && m.awesomeOscillator < 0
    ? 'The Awesome Oscillator is below zero, a second read of negative momentum.'
    : null],
  [8, ({ m }) => isNum(m.rsi14) && m.rsi14 > 70
    ? `RSI at ${m.rsi14.toFixed(0)} is overbought: after a run this steep, a pause or pullback is common, and buying here means paying up.`
    : null],
  [5, ({ m }) => isNum(m.rsi14) && m.rsi14 >= 30 && m.rsi14 < 40
    ? `RSI at ${m.rsi14.toFixed(0)} shows weak momentum without being washed out enough to suggest a bounce.`
    : null],
  [8, ({ m }) => isNum(m.adx) && m.adx >= 25 && isNum(m.plusDI) && isNum(m.minusDI) && m.minusDI > m.plusDI
    ? `ADX at ${m.adx.toFixed(0)} with -DI above +DI marks a strong downtrend — fighting it is expensive.`
    : null],
  [7, ({ m }) => isNum(m.relativeVolume) && m.relativeVolume >= 1.5 && isNum(m.changePercent) && m.changePercent < 0
    ? `Today's drop came on ${m.relativeVolume.toFixed(1)}x normal volume — that looks like distribution, not noise.`
    : null],
  [8, ({ m }) => isNum(m.bbPercentB) && m.bbPercentB > 1
    ? `Price closed above its upper Bollinger Band (${price(m.bbUpper)}), statistically stretched; such moves often snap back toward the middle band (${price(m.bbMiddle)}).`
    : null],
  [9, ({ m }) => isNum(m.avgVolume20) && m.avgVolume20 < 100_000
    ? `Liquidity is thin at about ${Math.round(m.avgVolume20 / 1000)}K shares a day: spreads are wider, and a large order can move the price against you.`
    : null],
  [4, ({ m }) => isNum(m.relativeVolume) && m.relativeVolume < 0.6
    ? `Volume is only ${m.relativeVolume.toFixed(1)}x normal, so today's move has little conviction behind it.`
    : null],
  [6, ({ m }) => isNum(m.percentOf52wHigh) && m.percentOf52wHigh < 70
    ? `It sits ${pct(100 - m.percentOf52wHigh)} below its 52-week high, and holders from higher up may sell into any recovery.`
    : null],
  [5, ({ m }) => isNum(m.atrPercent) && m.atrPercent >= 5
    ? `It swings about ${pct(m.atrPercent, 1)} a day (ATR), so a normal stop has to sit wide and position size has to shrink.`
    : null],
  [8, ({ f }) => isNum(f.eps) && f.eps < 0
    ? 'The company lost money in its last fiscal year, so the price rests on expectations rather than earnings.'
    : null],
  [7, ({ f }) => isNum(f.revenueGrowth) && f.revenueGrowth < 0
    ? `Revenue shrank ${ratioPct(-f.revenueGrowth)} last year.`
    : null],
  [5, ({ f }) => isNum(f.pe) && f.pe > 40
    ? `At ${f.pe.toFixed(0)} times earnings the valuation already assumes a lot of growth.`
    : null],
  [5, ({ f }) => isNum(f.debtEquity) && f.debtEquity > 2
    ? `Leverage is high (debt ${f.debtEquity.toFixed(1)} times equity), which magnifies any downturn.`
    : null],
  [7, ({ security }) => security?.kind === 'fund'
    ? 'As a fund, it can trade at a premium or discount to the value of its holdings, which none of these charts show — check the NAV before acting on the chart.'
    : null],
  [6, ({ security }) => security?.kind === 'adr' || security?.kind === 'foreign'
    ? `As a foreign issuer${security.country ? ` (${security.country})` : ''}, it carries currency and home-market risk that a US chart does not capture.`
    : null],
];

/**
 * What would change the picture: levels to watch, used only when a side has
 * too few points of its own to make five sentences. Still numbers from the
 * page, never a target or a forecast.
 */
const BULL_WATCH = [
  ({ m }) => isNum(m.sma50) && m.price < m.sma50
    ? `A close back above the 50-day average (${price(m.sma50)}, ${pct(gap(m.sma50, m.price), 1)} higher) would be the first sign the trend is turning.`
    : null,
  ({ m }) => isNum(m.sma200) && m.price < m.sma200 && (!isNum(m.sma50) || m.price >= m.sma50)
    ? `Reclaiming the 200-day average (${price(m.sma200)}) would turn the long-term trend up.`
    : null,
  ({ m }) => isNum(m.low52w) && m.low52w > 0 && m.price > m.low52w
    ? `The 52-week low at ${price(m.low52w)} (${pct(gap(m.price, m.low52w))} below) is where buyers stepped in before.`
    : null,
  ({ m }) => isNum(m.rsi14) && m.rsi14 >= 40 && m.rsi14 < 45
    ? `RSI at ${m.rsi14.toFixed(0)} is close to the healthy band; a push above 45 would confirm returning momentum.`
    : null,
];

const BEAR_WATCH = [
  ({ m }) => isNum(m.sma20) && m.price > m.sma20
    ? `A close below the 20-day average (${price(m.sma20)}, ${pct(gap(m.price, m.sma20), 1)} lower) would be the first crack in the short-term trend.`
    : null,
  ({ m }) => isNum(m.sma50) && m.price > m.sma50
    ? `The 50-day average at ${price(m.sma50)} is the next support; losing it would put the medium-term trend in question.`
    : null,
  ({ m }) => isNum(m.atr14) && m.atr14 > 0
    ? `A typical day moves it about ${price(m.atr14)} (ATR), so a stop much tighter than that is likely to be hit by noise.`
    : null,
  ({ m }) => isNum(m.rsi14) && m.rsi14 > 65 && m.rsi14 <= 70
    ? `RSI at ${m.rsi14.toFixed(0)} is nearing overbought, so the easy part of the move may be behind it.`
    : null,
];

const MIN_POINTS = 4;

function fill(points, watch, context) {
  if (points.length >= MIN_POINTS) return points;
  const extra = watch.map((rule) => rule(context)).filter(Boolean).map((text) => ({ weight: 0, text }));
  return [...points, ...extra.slice(0, MIN_POINTS - points.length)];
}

function collect(rules, context) {
  return rules
    .map(([weight, rule], order) => ({ weight, order, text: rule(context) }))
    .filter((point) => point.text)
    .sort((a, b) => b.weight - a.weight || a.order - b.order);
}

function verdict(side, points, other, score) {
  const strength = points.reduce((sum, p) => sum + p.weight, 0);
  const against = other.reduce((sum, p) => sum + p.weight, 0);
  const label = `Snake Score ${score.total}/100 (${score.label})`;
  if (side === 'bull') {
    if (!points.length) return `${label}: nothing in the data argues for buying right now.`;
    if (strength >= against * 1.5) return `${label}: the evidence leans clearly toward the buyers.`;
    if (strength > against) return `${label}: the buyers have a slight edge, with real objections on the other side.`;
    return `${label}: there is a case for buying, but it is the weaker one today.`;
  }
  if (!points.length) return 'Nothing in the data argues strongly against it right now; the main risk is the market itself.';
  if (strength >= against * 1.5) return 'The case against is the stronger one today.';
  if (strength > against) return 'The sellers have a slight edge, though the picture is mixed.';
  return 'The case against is the weaker one, but these risks are real.';
}

/**
 * @param {object} row  a scored row from api.js
 * @returns {{ bull: string[], bear: string[], technicalOnly: boolean }}
 */
export function buildOutlook(row) {
  const context = {
    m: row.metrics || {},
    f: row.fundamentals || {},
    security: row.security || null,
  };
  const bull = collect(BULL, context);
  const bear = collect(BEAR, context);

  const bullPoints = fill(bull, BULL_WATCH, context);
  const bearPoints = fill(bear, BEAR_WATCH, context);

  return {
    bull: [verdict('bull', bull, bear, row.score), ...bullPoints.slice(0, MAX_POINTS).map((p) => p.text)],
    bear: [verdict('bear', bear, bull, row.score), ...bearPoints.slice(0, MAX_POINTS).map((p) => p.text)],
    technicalOnly: !row.score?.fundamentalsAvailable,
  };
}
