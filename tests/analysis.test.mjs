/**
 * Snake Eye — the written case for and against.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOutlook } from '../js/analysis.js';
import { GLOSSARY } from '../js/glossary.js';
import { classifySecurity } from '../js/security.js';
import { scoreStock } from '../js/score.js';

const score = { total: 90, label: 'Strong Setup', fundamentalsAvailable: false };

// GRX on 2026-11-05, from the stock page: a steep run in a thin closed-end fund.
const grx = {
  metrics: {
    price: 10.43, changePercent: 0.19, sma20: 10.1, sma50: 9.9, sma200: 9.6,
    macd: 0.16, macdSignal: 0.1, macdHistogram: 0.06, macdHistogramPrev: 0.05,
    awesomeOscillator: 0.445, awesomeOscillatorPrev: 0.4, rsi14: 76.5, adx: 30, plusDI: 35, minusDI: 12,
    relativeVolume: 2.36, avgVolume20: 16_000, percentOf52wHigh: 100, high52w: 10.43,
    bbPercentB: 0.96, bbUpper: 10.5, bbMiddle: 10.0, atrPercent: 1.4,
  },
  fundamentals: {},
  security: { kind: 'fund', country: null },
  score,
};

test('each side has a verdict and at most five points', () => {
  const { bull, bear } = buildOutlook(grx);
  assert.ok(bull.length >= 5 && bull.length <= 6, `bull has ${bull.length}`);
  assert.ok(bear.length >= 3 && bear.length <= 6, `bear has ${bear.length}`);
  assert.match(bull[0], /^Snake Score 90\/100 \(Strong Setup\)/);
});

test('the risks of a thin, overbought fund are named', () => {
  const bear = buildOutlook(grx).bear.join(' ');
  assert.match(bear, /Ліквідність низька — близько 16 тис\. акцій/);
  assert.match(bear, /RSI 77 — перекупленість/);
  assert.match(bear, /Це фонд/);
});

test('the strongest points come first', () => {
  const { bull } = buildOutlook(grx);
  assert.match(bull[1], /бичачому порядку/);
});

test('missing numbers never print as NaN or undefined', () => {
  const empty = buildOutlook({ metrics: { price: 5 }, fundamentals: {}, score });
  const text = [...empty.bull, ...empty.bear].join(' ');
  assert.doesNotMatch(text, /NaN|undefined|null/);
  assert.match(empty.bull[0], /немає аргументів на користь купівлі/);
});

test('every score item has a glossary entry', () => {
  const row = { metrics: grx.metrics, fundamentals: { revenueGrowth: 0.1, eps: 1, epsGrowth: 0.1, pe: 12, roe: 0.2, debtEquity: 0.4 } };
  const { components } = scoreStock(row);
  const labels = Object.values(components).flatMap((c) => c.items.map((item) => item.label));
  const missing = labels.filter((label) => !GLOSSARY[label]);
  assert.deepEqual(missing, []);
});

test('security kind: SEC profile first, then the IBKR name', () => {
  assert.equal(classifySecurity({ name: 'GABELLI HEALTHCARE & WELL', profile: { kind: 'fund', industry: 'Closed-end fund' } }).label, 'Fund');
  assert.equal(classifySecurity({ name: 'AMBEV SA-ADR (NYSE)' }).kind, 'adr');
  assert.equal(classifySecurity({ name: 'NIO INC - ADR' }).kind, 'adr');
  assert.equal(classifySecurity({ name: 'ADAMS NATURAL RESOURCES FUND' }).kind, 'fund');
  assert.equal(classifySecurity({ name: 'REALTY INCOME TRUST' }).kind, 'stock');
  assert.equal(classifySecurity({ name: 'PLUG POWER INC', sector: 'Energy' }).sector, 'Energy');
});

test('a thin side is topped up with levels to watch', () => {
  const downtrend = {
    metrics: {
      price: 17.59, sma20: 18.2, sma50: 19.56, sma200: 22.08, macd: -0.1, macdSignal: -0.2,
      macdHistogram: 0.1, macdHistogramPrev: 0.05, rsi14: 42, low52w: 15.1, atr14: 0.6, avgVolume20: 2e6,
    },
    fundamentals: {},
    score: { total: 41, label: 'Weak Setup', fundamentalsAvailable: false },
  };
  const { bull } = buildOutlook(downtrend);
  assert.equal(bull.length, 5);
  assert.match(bull.join(' '), /Закриття знову вище 50-денної середньої \(\$19\.56/);
});
