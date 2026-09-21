/**
 * Snake Eye — filter behaviour tests.
 *
 * Focused on the ways a scan can come back empty for reasons the user cannot
 * see, which is the worst failure mode a screener has.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyFilters,
  countActiveFilters,
  criteriaFromQuery,
  criteriaToQuery,
  emptyCriteria,
  nearestMisses,
  normalizeCriteria,
} from '../js/filters.js';

const row = (exchange, price) => ({
  ticker: 'TEST',
  exchange,
  fundamentals: {},
  metrics: { price, rsi14: 50, volume: 1e6, avgVolume20: 1e6, relativeVolume: 1 },
});

const universe = [row('NASDAQ', 100), row('NYSE', 20), row('ARCA', 50), row('UNKNOWN', 5)];

test('empty criteria match the whole universe whatever the exchange is called', () => {
  // Defaulting to a hard-coded NYSE + NASDAQ list made every ARCA or
  // venue-suffixed row invisible, and "Reset filters" could not bring it back.
  assert.equal(applyFilters(universe, emptyCriteria()).length, universe.length);
  assert.equal(countActiveFilters(emptyCriteria()), 0);
});

test('an exchange filter applies only when the user picks one', () => {
  const picked = applyFilters(universe, normalizeCriteria({ exchanges: ['NASDAQ', 'ARCA'] }));
  assert.deepEqual(picked.map((item) => item.exchange), ['NASDAQ', 'ARCA']);
});

test('exchange names are compared case-insensitively', () => {
  const picked = applyFilters(universe, normalizeCriteria({ exchanges: ['nasdaq'] }));
  assert.equal(picked.length, 1);
});

test('an exchange the dataset does not contain is still a valid filter', () => {
  // The options are no longer restricted to a fixed list, so a preset naming a
  // venue that is absent yields nothing rather than being silently dropped.
  assert.equal(applyFilters(universe, normalizeCriteria({ exchanges: ['LSE'] })).length, 0);
});

test('criteria survive a round trip through the URL', () => {
  const original = normalizeCriteria({ exchanges: ['NASDAQ'], priceMin: 2, priceMax: 30, macdBullish: true });
  assert.deepEqual(criteriaFromQuery(criteriaToQuery(original)), original);
});

test('a price range excludes rows outside it', () => {
  const picked = applyFilters(universe, normalizeCriteria({ priceMin: 2, priceMax: 30 }));
  assert.deepEqual(picked.map((item) => item.metrics.price), [20, 5]);
});

/* ------------------------------------------------------- nearest misses */

const scored = (ticker, price, rsi, total, tone = 'good') => ({
  ticker,
  exchange: 'NASDAQ',
  fundamentals: {},
  metrics: { price, rsi14: rsi, volume: 1e6, avgVolume20: 1e6, relativeVolume: 1 },
  score: { total, tone },
});

test('a strategy that matches nothing still names what came closest', () => {
  // A saved strategy asks six to nine things at once. Across a personal list of
  // twenty symbols that is usually unsatisfiable, and "nothing matched" hides
  // the fact that some missed by one condition.
  const rows = [
    scored('AAA', 5, 50, 70),    // passes everything
    scored('BBB', 50, 50, 80),   // too expensive
    scored('CCC', 5, 90, 60),    // RSI too high
    scored('DDD', 50, 95, 40),   // both
  ];
  const criteria = normalizeCriteria({ priceMin: '2', priceMax: '30', rsiMin: '40', rsiMax: '70' });

  const close = nearestMisses(rows, criteria);
  assert.equal(close[0].row.ticker, 'AAA');
  assert.equal(close[0].met, 4);
  assert.deepEqual(close[0].failed, []);
  assert.equal(close.at(-1).row.ticker, 'DDD');
  assert.equal(close.at(-1).met, 2);
});

test('ties among near misses are broken by the score, not by input order', () => {
  const rows = [scored('LOW', 50, 50, 30), scored('HIGH', 50, 50, 90)];
  const criteria = normalizeCriteria({ priceMax: '30', rsiMin: '40' });
  assert.deepEqual(nearestMisses(rows, criteria).map((e) => e.row.ticker), ['HIGH', 'LOW']);
});

test('the exchange counts as a criterion, so "met" cannot come out short', () => {
  // countActiveFilters deliberately leaves the exchange out; matchRow tests it.
  // Counting the first way would report 1 of 1 for a row failing both.
  const rows = [scored('AAA', 5, 50, 70)];
  const criteria = normalizeCriteria({ exchanges: ['NYSE'], priceMax: '30' });
  const [entry] = nearestMisses(rows, criteria);
  assert.equal(entry.total, 2);
  assert.equal(entry.met, 1, 'passes the price, fails the exchange');
});

test('with no filters active there is nothing to be close to', () => {
  assert.deepEqual(nearestMisses([scored('AAA', 5, 50, 70)], emptyCriteria()), []);
});
