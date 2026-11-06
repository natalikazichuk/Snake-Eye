/**
 * Snake Eye — what a saved strategy selects, in Ukrainian, for its hover tip.
 *
 * The condition list is built from the strategy's own criteria, not written
 * by hand, so the tip cannot drift from what the scan actually applies when a
 * preset in data/presets.json is edited.
 *
 * Pure — no DOM — so tests/preset-tip.test.mjs can drive it.
 */

import { FILTER_FIELDS } from './filters.js';

/** 500000 -> "500 тис.", 2000000 -> "2 млн". */
function amount(value) {
  if (value >= 1e9) return `${+(value / 1e9).toFixed(1)} млрд`;
  if (value >= 1e6) return `${+(value / 1e6).toFixed(1)} млн`;
  if (value >= 1e3) return `${+(value / 1e3).toFixed(1)} тис.`;
  return String(value);
}

const money = (value) => (value >= 1e3 ? `$${amount(value)}` : `$${value}`);

/** One phrase per criterion; ranges (min + max of one metric) read as one. */
const PHRASES = {
  exchanges: (v) => `біржі: ${v.join(', ')}`,
  price: (min, max) => range('ціна', min, max, money),
  rsi: (min, max) => range('RSI', min, max, String),
  volumeMin: (v) => `обсяг сьогодні ≥ ${amount(v)}`,
  avgVolumeMin: (v) => `середній обсяг за 20 днів ≥ ${amount(v)} акцій`,
  relVolumeMin: (v) => `відносний обсяг ≥ ${v}x від звичайного`,
  marketCapMin: (v) => `капіталізація ≥ ${money(v)}`,
  marketCapMax: (v) => `капіталізація ≤ ${money(v)}`,
  revenueMin: (v) => `виручка ≥ ${money(v)}`,
  revenueGrowthMin: (v) => `зростання виручки ≥ ${v}%`,
  epsMin: (v) => `EPS ≥ ${v}`,
  epsGrowthMin: (v) => `зростання EPS ≥ ${v}%`,
  peMax: (v) => `P/E ≤ ${v}`,
  psMax: (v) => `P/S ≤ ${v}`,
  roeMin: (v) => `ROE ≥ ${v}%`,
  debtEquityMax: (v) => `борг / капітал ≤ ${v}`,
  grossMarginMin: (v) => `валова маржа ≥ ${v}%`,
  operatingMarginMin: (v) => `операційна маржа ≥ ${v}%`,
  currentRatioMin: (v) => `поточна ліквідність ≥ ${v}`,
  adxMin: (v) => `ADX ≥ ${v} (є тренд)`,
  atrPercentMin: (v) => `денний діапазон (ATR) ≥ ${v}%`,
  atrPercentMax: (v) => `денний діапазон (ATR) ≤ ${v}%`,
  stochasticMin: (v) => `стохастик %K ≥ ${v}`,
  stochasticMax: (v) => `стохастик %K ≤ ${v}`,
  near52wHigh: (v) => `ціна не нижче ${v}% від річного максимуму`,
  macdBullish: () => 'MACD вище сигнальної лінії',
  macdCross: () => 'MACD щойно перетнув сигнальну лінію вгору',
  aoPositive: () => 'Awesome Oscillator вище нуля',
  aoRising: () => 'Awesome Oscillator зростає',
  priceAboveSma20: () => 'ціна вище SMA20',
  priceAboveSma50: () => 'ціна вище SMA50',
  priceAboveSma200: () => 'ціна вище SMA200',
  priceAboveEma20: () => 'ціна вище EMA20',
  priceAboveEma50: () => 'ціна вище EMA50',
  priceAboveEma200: () => 'ціна вище EMA200',
  smaStacked: () => 'SMA20 > SMA50 > SMA200',
  bbBreakout: () => 'ціна вище верхньої смуги Боллінджера',
};

function range(name, min, max, format) {
  if (min !== undefined && max !== undefined) return `${name} від ${format(min)} до ${format(max)}`;
  if (min !== undefined) return `${name} ≥ ${format(min)}`;
  return `${name} ≤ ${format(max)}`;
}

const FUNDAMENTAL = new Set(FILTER_FIELDS.filter((f) => f.group === 'fundamentals').map((f) => f.key));

/** The conditions a criteria object applies, as Ukrainian phrases, in schema order. */
export function describeCriteria(criteria = {}) {
  const phrases = [];
  const done = new Set();

  for (const field of FILTER_FIELDS) {
    const { key } = field;
    const value = criteria[key];
    if (value === undefined || value === null || value === false || done.has(key)) continue;

    const pair = key === 'priceMin' || key === 'priceMax' ? 'price' : key === 'rsiMin' || key === 'rsiMax' ? 'rsi' : null;
    if (pair) {
      done.add(`${pair}Min`).add(`${pair}Max`);
      phrases.push(PHRASES[pair](criteria[`${pair}Min`], criteria[`${pair}Max`]));
      continue;
    }

    done.add(key);
    const phrase = PHRASES[key];
    // A filter added to filters.js without a phrase here still shows, in English.
    phrases.push(phrase ? phrase(value) : `${field.label}: ${value === true ? 'так' : value}`);
  }

  // Keys the schema does not know are ignored by the scan, and the loop above
  // only walks the schema, so the tip skips them too.
  return phrases;
}

/** Full hover text: the summary, then every condition, then a note when it needs fundamentals. */
export function presetTip(preset) {
  const criteria = preset.criteria || {};
  const conditions = describeCriteria(criteria);
  const needsFundamentals = Object.keys(criteria).some((key) => FUNDAMENTAL.has(key));

  const parts = [];
  if (preset.tipUk) parts.push(preset.tipUk);
  if (conditions.length) parts.push(`Умови: ${conditions.join('; ')}.`);
  if (needsFundamentals) {
    parts.push('Тікери без фундаментальних даних (фонди, частина ADR) цю стратегію не проходять.');
  }
  return parts.join(' ');
}
