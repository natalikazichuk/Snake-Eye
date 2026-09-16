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
