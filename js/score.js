/**
 * Snake Eye — the Snake Score.
 *
 * Four sub-scores, each 0-100, combined into one 0-100 headline number:
 *
 *   Technical   40%  trend structure — price against its moving averages
 *   Momentum    25%  MACD, Awesome Oscillator, RSI
 *   Volume      20%  relative volume and liquidity
 *   Fundamental 15%  growth, profitability and balance sheet
 *
 * The score measures how well a stock matches the setup Snake Eye looks for.
 * It is a ranking aid, not a prediction and not investment advice.
 */

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

export const COMPONENT_WEIGHTS = {
  technical: 0.4,
  momentum: 0.25,
  volume: 0.2,
  fundamental: 0.15,
};

/** Linear 0..1 ramp between `from` and `to`, clamped at both ends. */
function ramp(value, from, to) {
  if (!isNum(value)) return 0;
  if (from === to) return value >= to ? 1 : 0;
  return Math.max(0, Math.min(1, (value - from) / (to - from)));
}

/** Collects weighted checks and reports both the total and what earned it. */
function tally() {
  const items = [];
  return {
    /** `fraction` is 0..1; pass a boolean for an all-or-nothing check. */
    add(label, max, fraction, detail = '') {
      const ratio = typeof fraction === 'boolean' ? (fraction ? 1 : 0) : Math.max(0, Math.min(1, fraction || 0));
      items.push({ label, max, points: Math.round(max * ratio * 10) / 10, detail });
    },
    build() {
      const max = items.reduce((sum, item) => sum + item.max, 0);
      const points = items.reduce((sum, item) => sum + item.points, 0);
      return {
        score: max === 0 ? 0 : Math.round((points / max) * 100),
        items,
      };
    },
  };
}

function technicalScore(m) {
  const t = tally();
  t.add('Price > SMA20', 15, isNum(m.sma20) && m.price > m.sma20);
  t.add('Price > SMA50', 20, isNum(m.sma50) && m.price > m.sma50);
  t.add('Price > SMA200', 20, isNum(m.sma200) && m.price > m.sma200);
  t.add('SMA20 > SMA50', 10, isNum(m.sma20) && isNum(m.sma50) && m.sma20 > m.sma50);
  t.add('SMA50 > SMA200', 10, isNum(m.sma50) && isNum(m.sma200) && m.sma50 > m.sma200);
  // A trending move scores higher than a drifting one: ADX 20 -> 40 ramps up.
  t.add('ADX trend strength', 15, ramp(m.adx, 18, 40), isNum(m.adx) ? m.adx.toFixed(0) : '—');
  t.add('Upper half of Bollinger range', 10, ramp(m.bbPercentB, 0.4, 0.9));
  return t.build();
}

function momentumScore(m) {
  const t = tally();
  const macdBullish = isNum(m.macd) && isNum(m.macdSignal) && m.macd > m.macdSignal;
  t.add('MACD above signal', 30, macdBullish);
  t.add('MACD histogram rising', 15, isNum(m.macdHistogram) && isNum(m.macdHistogramPrev) && m.macdHistogram > m.macdHistogramPrev);
  t.add('Awesome Oscillator > 0', 25, isNum(m.awesomeOscillator) && m.awesomeOscillator > 0);
  t.add('Awesome Oscillator rising', 15, isNum(m.awesomeOscillator) && isNum(m.awesomeOscillatorPrev) && m.awesomeOscillator > m.awesomeOscillatorPrev);

  // RSI is scored as a band, not a threshold: 40-70 is the healthy zone, and
  // credit falls off on either side of it.
  let rsiFraction = 0;
  if (isNum(m.rsi14)) {
    if (m.rsi14 >= 45 && m.rsi14 <= 65) rsiFraction = 1;
    else if (m.rsi14 < 45) rsiFraction = ramp(m.rsi14, 30, 45);
    else rsiFraction = 1 - ramp(m.rsi14, 65, 85);
  }
  t.add('RSI in the healthy band', 15, rsiFraction, isNum(m.rsi14) ? m.rsi14.toFixed(0) : '—');
  return t.build();
}

function volumeScore(m) {
  const t = tally();
  t.add(
    'Relative volume',
    40,
    ramp(m.relativeVolume, 0.8, 2),
    isNum(m.relativeVolume) ? `${m.relativeVolume.toFixed(2)}x` : '—',
  );
  // Liquidity on a log ramp: 100K is thin, 5M+ is fully liquid.
  const liquidity = isNum(m.avgVolume20) && m.avgVolume20 > 0
    ? ramp(Math.log10(m.avgVolume20), 5, 6.7)
    : 0;
  t.add('Average volume (liquidity)', 30, liquidity);
  const surge = isNum(m.volume) && isNum(m.avgVolume50) && m.avgVolume50 > 0
    ? ramp(m.volume / m.avgVolume50, 0.9, 2.2)
    : 0;
  t.add('Volume vs 50-day average', 30, surge);
  return t.build();
}

function fundamentalScore(f) {
  const t = tally();
  t.add('Revenue growth', 25, ramp(f.revenueGrowth, 0, 0.25), formatPercent(f.revenueGrowth));
  t.add('Positive EPS', 20, isNum(f.eps) && f.eps > 0);
  t.add('EPS growth', 15, ramp(f.epsGrowth, 0, 0.3), formatPercent(f.epsGrowth));
  // Cheaper is better, and a company with no positive earnings gets nothing.
  t.add('Valuation (P/E)', 15, isNum(f.pe) && f.pe > 0 ? 1 - ramp(f.pe, 12, 45) : 0, isNum(f.pe) ? f.pe.toFixed(1) : '—');
  t.add('Return on equity', 15, ramp(f.roe, 0, 0.2), formatPercent(f.roe));
  t.add('Debt / equity', 10, isNum(f.debtEquity) ? 1 - ramp(f.debtEquity, 0.5, 2) : 0, isNum(f.debtEquity) ? f.debtEquity.toFixed(2) : '—');
  return t.build();
}

function formatPercent(value) {
  return isNum(value) ? `${(value * 100).toFixed(1)}%` : '—';
}

/** Verdict shown next to the score bar. */
export function scoreLabel(total) {
  if (total >= 85) return { label: 'Strong Setup', tone: 'strong' };
  if (total >= 70) return { label: 'Solid Setup', tone: 'good' };
  if (total >= 55) return { label: 'Watching', tone: 'neutral' };
  if (total >= 40) return { label: 'Weak Setup', tone: 'weak' };
  return { label: 'No Setup', tone: 'bad' };
}

/**
 * Score one row (`{ fundamentals, metrics }`) and return the headline number
 * plus the full breakdown the stock page renders.
 */
export function scoreStock(row) {
  const components = {
    technical: technicalScore(row.metrics),
    momentum: momentumScore(row.metrics),
    volume: volumeScore(row.metrics),
    fundamental: fundamentalScore(row.fundamentals),
  };

  const total = Math.round(
    Object.entries(COMPONENT_WEIGHTS).reduce(
      (sum, [key, weight]) => sum + components[key].score * weight,
      0,
    ),
  );

  return { total, ...scoreLabel(total), components };
}
