/**
 * Snake Eye — indicator tests.
 *
 * Indicators are the layer where a silent error propagates into every filter
 * and every score, so each one is checked against a reference or an invariant,
 * and the awkward cases (not enough history, a flat series, no volume) are
 * checked explicitly.
 *
 *   node --test tests/*.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adx,
  analyze,
  atr,
  awesomeOscillator,
  bollingerBands,
  ema,
  macd,
  rsi,
  sma,
  stochastic,
} from '../js/indicators.js';

/**
 * Wilder's published worked example (New Concepts in Technical Trading
 * Systems). The reference RSI values are quoted to two decimals in the book.
 */
const WILDER_CLOSES = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
  45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64,
  46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57,
  43.42, 42.66, 43.13,
];

test('RSI matches Wilder\'s worked example', () => {
  const values = rsi(WILDER_CLOSES, 14).filter((value) => value !== null);
  assert.equal(values.length, WILDER_CLOSES.length - 14);
  assert.ok(Math.abs(values[0] - 70.46) < 0.1, `first RSI ${values[0]}`);
  assert.ok(Math.abs(values.at(-1) - 37.79) < 0.5, `last RSI ${values.at(-1)}`);
});

test('RSI stays inside 0..100 and reports 100 for a series that only rises', () => {
  const rising = Array.from({ length: 30 }, (_, i) => 10 + i);
  const values = rsi(rising, 14).filter((value) => value !== null);
  assert.ok(values.every((value) => value >= 0 && value <= 100));
  assert.equal(values.at(-1), 100, 'no losses in the window means no defined ratio');
});

test('SMA and EMA are front-padded with null until they have enough bars', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(sma([1, 2], 5), [null, null], 'too little history yields no values');
});

test('MACD histogram is the line minus its signal', () => {
  const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 10);
  const { line, signal, histogram } = macd(closes);
  const last = closes.length - 1;
  assert.ok(Math.abs(histogram[last] - (line[last] - signal[last])) < 1e-9);
  assert.equal(signal.findIndex((v) => v !== null) >= line.findIndex((v) => v !== null), true,
    'the signal line cannot start before the MACD line exists');
});

test('Awesome Oscillator is SMA5 minus SMA34 of the median price', () => {
  const high = Array.from({ length: 60 }, (_, i) => 10 + i * 0.1);
  const low = high.map((value) => value - 1);
  const ao = awesomeOscillator(high, low);
  assert.equal(ao.slice(0, 33).every((value) => value === null), true);
  assert.ok(ao.at(-1) > 0, 'a steady uptrend gives a positive AO');
});

test('ATR and ADX are defined on a real-looking series and stay non-negative', () => {
  const length = 120;
  const close = Array.from({ length }, (_, i) => 50 + Math.sin(i / 8) * 5 + i * 0.05);
  const high = close.map((value) => value + 0.8);
  const low = close.map((value) => value - 0.8);

  const atrValues = atr(high, low, close, 14).filter((value) => value !== null);
  assert.ok(atrValues.length > 0 && atrValues.every((value) => value >= 0));

  const { adx: adxValues, plusDI, minusDI } = adx(high, low, close, 14);
  const lastAdx = adxValues.filter((value) => value !== null).at(-1);
  assert.ok(lastAdx >= 0 && lastAdx <= 100, `ADX out of range: ${lastAdx}`);
  assert.ok(plusDI.at(-1) >= 0 && minusDI.at(-1) >= 0);
});

test('a flat series does not divide by zero', () => {
  const flat = new Array(60).fill(25);
  const { k, d } = stochastic(flat, flat, flat, 14, 3);
  assert.equal(k.at(-1), 50, 'no range means the midpoint, not NaN');
  assert.ok(Number.isFinite(d.at(-1)));

  const bands = bollingerBands(flat, 20, 2);
  assert.equal(bands.upper.at(-1), 25);
  assert.equal(bands.percentB.at(-1), 0.5);
  assert.ok(Number.isFinite(bands.bandwidth.at(-1)));
});

test('analyze() reports nulls, not guesses, when history is short', () => {
  const bars = 30;
  const close = Array.from({ length: bars }, (_, i) => 10 + i * 0.1);
  const snapshot = analyze({
    close,
    high: close.map((v) => v + 0.2),
    low: close.map((v) => v - 0.2),
    volume: new Array(bars).fill(1_000_000),
  });

  assert.equal(snapshot.sma20 !== null, true, '20 bars are available');
  assert.equal(snapshot.sma50, null, 'SMA50 needs 50 bars');
  assert.equal(snapshot.sma200, null, 'SMA200 needs 200 bars');
  assert.ok(Number.isFinite(snapshot.rsi14));
});

test('relative volume excludes today from its own baseline', () => {
  const bars = 40;
  const close = new Array(bars).fill(20);
  const volume = new Array(bars).fill(1_000_000);
  volume[bars - 1] = 3_000_000; // today is a 3x day

  const snapshot = analyze({
    close,
    high: close.map((v) => v + 0.5),
    low: close.map((v) => v - 0.5),
    volume,
  });

  assert.equal(snapshot.avgVolume20, 1_000_000, 'the spike must not inflate its own average');
  assert.equal(snapshot.relativeVolume, 3);
});

test('zero volume does not produce NaN or Infinity', () => {
  const bars = 40;
  const close = new Array(bars).fill(5);
  const snapshot = analyze({
    close,
    high: close.map((v) => v + 0.1),
    low: close.map((v) => v - 0.1),
    volume: new Array(bars).fill(0),
  });

  assert.equal(snapshot.relativeVolume, null, 'no baseline volume means no ratio');
  assert.equal(snapshot.volume, 0);
});
