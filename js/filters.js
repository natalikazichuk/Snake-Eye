/**
 * Snake Eye — filter schema and matching.
 *
 * Every filter the scanner supports is declared once in `FILTER_FIELDS`. The
 * form, the URL query string, the presets and the matching logic all read that
 * one list, so adding a filter means adding a field here plus an input whose
 * `name` matches the field key.
 *
 * Field types:
 *   `set`      — multi-value membership (exchange checkboxes)
 *   `min`/`max`— numeric bound applied to `value(row)`
 *   `flag`     — checkbox that is only applied when checked, tested by `test(row)`
 */

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

export const FILTER_FIELDS = [
  {
    key: 'exchanges',
    type: 'set',
    group: 'market',
    label: 'Exchange',
    options: ['NYSE', 'NASDAQ'],
    value: (row) => row.exchange,
  },

  { key: 'priceMin', type: 'min', group: 'price', label: 'Min price', value: (row) => row.metrics.price },
  { key: 'priceMax', type: 'max', group: 'price', label: 'Max price', value: (row) => row.metrics.price },

  { key: 'volumeMin', type: 'min', group: 'volume', label: 'Min volume', value: (row) => row.metrics.volume },
  { key: 'avgVolumeMin', type: 'min', group: 'volume', label: 'Min average volume (20d)', value: (row) => row.metrics.avgVolume20 },
  { key: 'relVolumeMin', type: 'min', group: 'volume', label: 'Min relative volume', value: (row) => row.metrics.relativeVolume },

  { key: 'marketCapMin', type: 'min', group: 'fundamentals', label: 'Min market cap', value: (row) => row.fundamentals.marketCap },
  { key: 'marketCapMax', type: 'max', group: 'fundamentals', label: 'Max market cap', value: (row) => row.fundamentals.marketCap },
  { key: 'revenueMin', type: 'min', group: 'fundamentals', label: 'Min revenue', value: (row) => row.fundamentals.revenue },
  { key: 'revenueGrowthMin', type: 'min', group: 'fundamentals', label: 'Min revenue growth %', value: (row) => pct(row.fundamentals.revenueGrowth) },
  { key: 'epsMin', type: 'min', group: 'fundamentals', label: 'Min EPS', value: (row) => row.fundamentals.eps },
  { key: 'epsGrowthMin', type: 'min', group: 'fundamentals', label: 'Min EPS growth %', value: (row) => pct(row.fundamentals.epsGrowth) },
  { key: 'peMax', type: 'max', group: 'fundamentals', label: 'Max P/E', value: (row) => row.fundamentals.pe },
  { key: 'psMax', type: 'max', group: 'fundamentals', label: 'Max P/S', value: (row) => row.fundamentals.ps },
  { key: 'roeMin', type: 'min', group: 'fundamentals', label: 'Min ROE %', value: (row) => pct(row.fundamentals.roe) },
  { key: 'debtEquityMax', type: 'max', group: 'fundamentals', label: 'Max debt/equity', value: (row) => row.fundamentals.debtEquity },
  { key: 'grossMarginMin', type: 'min', group: 'fundamentals', label: 'Min gross margin %', value: (row) => pct(row.fundamentals.grossMargin) },
  { key: 'operatingMarginMin', type: 'min', group: 'fundamentals', label: 'Min operating margin %', value: (row) => pct(row.fundamentals.operatingMargin) },
  { key: 'currentRatioMin', type: 'min', group: 'fundamentals', label: 'Min current ratio', value: (row) => row.fundamentals.currentRatio },

  { key: 'rsiMin', type: 'min', group: 'technical', label: 'Min RSI', value: (row) => row.metrics.rsi14 },
  { key: 'rsiMax', type: 'max', group: 'technical', label: 'Max RSI', value: (row) => row.metrics.rsi14 },
  { key: 'adxMin', type: 'min', group: 'technical', label: 'Min ADX', value: (row) => row.metrics.adx },
  { key: 'atrPercentMin', type: 'min', group: 'technical', label: 'Min ATR %', value: (row) => row.metrics.atrPercent },
  { key: 'atrPercentMax', type: 'max', group: 'technical', label: 'Max ATR %', value: (row) => row.metrics.atrPercent },
  { key: 'stochasticMin', type: 'min', group: 'technical', label: 'Min stochastic %K', value: (row) => row.metrics.stochasticK },
  { key: 'stochasticMax', type: 'max', group: 'technical', label: 'Max stochastic %K', value: (row) => row.metrics.stochasticK },
  { key: 'near52wHigh', type: 'min', group: 'technical', label: 'Within % of 52w high', value: (row) => row.metrics.percentOf52wHigh },

  {
    key: 'macdBullish',
    type: 'flag',
    group: 'technical',
    label: 'MACD above signal',
    test: (row) => isNum(row.metrics.macd) && isNum(row.metrics.macdSignal) && row.metrics.macd > row.metrics.macdSignal,
  },
  {
    key: 'macdCross',
    type: 'flag',
    group: 'technical',
    label: 'MACD crossed up',
    test: (row) =>
      isNum(row.metrics.macdHistogram) &&
      isNum(row.metrics.macdHistogramPrev) &&
      row.metrics.macdHistogram > 0 &&
      row.metrics.macdHistogramPrev <= 0,
  },
  {
    key: 'aoPositive',
    type: 'flag',
    group: 'technical',
    label: 'Awesome Oscillator positive',
    test: (row) => isNum(row.metrics.awesomeOscillator) && row.metrics.awesomeOscillator > 0,
  },
  {
    key: 'aoRising',
    type: 'flag',
    group: 'technical',
    label: 'Awesome Oscillator rising',
    test: (row) =>
      isNum(row.metrics.awesomeOscillator) &&
      isNum(row.metrics.awesomeOscillatorPrev) &&
      row.metrics.awesomeOscillator > row.metrics.awesomeOscillatorPrev,
  },
  { key: 'priceAboveSma20', type: 'flag', group: 'technical', label: 'Price > SMA20', test: (row) => above(row.metrics.price, row.metrics.sma20) },
  { key: 'priceAboveSma50', type: 'flag', group: 'technical', label: 'Price > SMA50', test: (row) => above(row.metrics.price, row.metrics.sma50) },
  { key: 'priceAboveSma200', type: 'flag', group: 'technical', label: 'Price > SMA200', test: (row) => above(row.metrics.price, row.metrics.sma200) },
  { key: 'priceAboveEma20', type: 'flag', group: 'technical', label: 'Price > EMA20', test: (row) => above(row.metrics.price, row.metrics.ema20) },
  { key: 'priceAboveEma50', type: 'flag', group: 'technical', label: 'Price > EMA50', test: (row) => above(row.metrics.price, row.metrics.ema50) },
  { key: 'priceAboveEma200', type: 'flag', group: 'technical', label: 'Price > EMA200', test: (row) => above(row.metrics.price, row.metrics.ema200) },
  {
    key: 'smaStacked',
    type: 'flag',
    group: 'technical',
    label: 'SMA20 > SMA50 > SMA200',
    test: (row) =>
      above(row.metrics.sma20, row.metrics.sma50) && above(row.metrics.sma50, row.metrics.sma200),
  },
  {
    key: 'bbBreakout',
    type: 'flag',
    group: 'technical',
    label: 'Close above upper Bollinger Band',
    test: (row) => above(row.metrics.price, row.metrics.bbUpper),
  },
];

function pct(value) {
  return isNum(value) ? value * 100 : null;
}

function above(a, b) {
  return isNum(a) && isNum(b) && a > b;
}

const FIELD_BY_KEY = new Map(FILTER_FIELDS.map((field) => [field.key, field]));

export function getField(key) {
  return FIELD_BY_KEY.get(key) || null;
}

/**
 * Criteria with no filter active at all — the whole universe.
 *
 * Deliberately empty. Defaulting to a hard-coded NYSE + NASDAQ list meant that
 * a provider reporting anything else (ARCA, BATS, NASDAQ.NMS, a Canadian
 * venue) matched nothing and could not be reset back into view.
 */
export function emptyCriteria() {
  return {};
}

/**
 * Drop empty values so the rest of the app can treat "key present" as
 * "filter active".
 */
export function normalizeCriteria(raw = {}) {
  const criteria = {};

  for (const field of FILTER_FIELDS) {
    const value = raw[field.key];
    if (value === undefined || value === null || value === '') continue;

    if (field.type === 'set') {
      const list = (Array.isArray(value) ? value : [value])
        .map((item) => String(item).toUpperCase())
        .filter(Boolean);
      if (list.length) criteria[field.key] = list;
    } else if (field.type === 'flag') {
      // Checkboxes arrive as `true`, URLs as the string '1', form posts as 'on'.
      if (value === true || value === 1 || value === '1' || value === 'true' || value === 'on') {
        criteria[field.key] = true;
      }
    } else {
      const num = typeof value === 'number' ? value : Number(String(value).trim());
      if (Number.isFinite(num)) criteria[field.key] = num;
    }
  }

  return criteria;
}

/** How many filters are actually narrowing the scan (exchange excluded). */
export function countActiveFilters(criteria) {
  return Object.keys(criteria).filter((key) => key !== 'exchanges' && FIELD_BY_KEY.has(key)).length;
}

/**
 * Test one row against the criteria.
 *
 * A filter on a metric the row cannot supply (no P/E for a loss-making
 * company, no SMA200 before 200 bars) fails rather than passes: the user asked
 * for a property that cannot be confirmed.
 */
export function matchRow(row, criteria) {
  const failed = [];

  for (const [key, value] of Object.entries(criteria)) {
    const field = FIELD_BY_KEY.get(key);
    if (!field) continue;

    if (field.type === 'set') {
      if (!value.includes(field.value(row))) failed.push(field.label);
      continue;
    }

    if (field.type === 'flag') {
      if (value && !field.test(row)) failed.push(field.label);
      continue;
    }

    const actual = field.value(row);
    if (!isNum(actual)) {
      failed.push(`${field.label} (no data)`);
      continue;
    }
    if (field.type === 'min' && actual < value) failed.push(field.label);
    if (field.type === 'max' && actual > value) failed.push(field.label);
  }

  return { passed: failed.length === 0, failed };
}

/** Filter a universe down to the rows that satisfy every active criterion. */
export function applyFilters(rows, criteria) {
  return rows.filter((row) => matchRow(row, criteria).passed);
}

/** Criteria -> URLSearchParams, so a scan can be shared or bookmarked. */
export function criteriaToQuery(criteria) {
  const params = new URLSearchParams();
  for (const field of FILTER_FIELDS) {
    const value = criteria[field.key];
    if (value === undefined) continue;
    if (field.type === 'set') params.set(field.key, value.join(','));
    else if (field.type === 'flag') params.set(field.key, '1');
    else params.set(field.key, String(value));
  }
  return params;
}

/** URLSearchParams (or a query string) -> criteria. */
export function criteriaFromQuery(input) {
  const params = input instanceof URLSearchParams ? input : new URLSearchParams(input);
  const raw = {};
  for (const field of FILTER_FIELDS) {
    if (!params.has(field.key)) continue;
    const value = params.get(field.key);
    raw[field.key] = field.type === 'set' ? value.split(',').filter(Boolean) : value;
  }
  return normalizeCriteria(raw);
}

/** Short human-readable chips describing the active filters. */
export function describeCriteria(criteria) {
  const chips = [];
  const exchanges = criteria.exchanges || [];
  if (exchanges.length === 1) chips.push(exchanges[0]);

  const pair = (minKey, maxKey, label, format = (v) => v) => {
    const min = criteria[minKey];
    const max = criteria[maxKey];
    if (min !== undefined && max !== undefined) chips.push(`${label} ${format(min)}–${format(max)}`);
    else if (min !== undefined) chips.push(`${label} > ${format(min)}`);
    else if (max !== undefined) chips.push(`${label} < ${format(max)}`);
  };

  pair('priceMin', 'priceMax', 'Price', (v) => `$${v}`);
  pair('rsiMin', 'rsiMax', 'RSI');
  pair('atrPercentMin', 'atrPercentMax', 'ATR', (v) => `${v}%`);
  pair('stochasticMin', 'stochasticMax', 'Stoch');
  pair('marketCapMin', 'marketCapMax', 'Mkt cap');

  const handled = new Set([
    'exchanges', 'priceMin', 'priceMax', 'rsiMin', 'rsiMax', 'atrPercentMin',
    'atrPercentMax', 'stochasticMin', 'stochasticMax', 'marketCapMin', 'marketCapMax',
  ]);

  for (const [key, value] of Object.entries(criteria)) {
    if (handled.has(key)) continue;
    const field = FIELD_BY_KEY.get(key);
    if (!field) continue;
    if (field.type === 'flag') chips.push(field.label);
    else chips.push(`${field.label.replace(/^(Min|Max) /, '')} ${field.type === 'min' ? '>' : '<'} ${value}`);
  }

  return chips;
}
