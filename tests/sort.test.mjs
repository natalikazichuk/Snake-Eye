/**
 * Snake Eye — table sorting.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { sortBy } from '../js/sort.js';

const rows = [
  { t: 'PLUG', v: 3 },
  { t: 'AMC', v: null },
  { t: 'NIO', v: 7 },
  { t: 'GRX', v: 3 },
  { t: 'BBD', v: undefined },
];
const tickers = (list) => list.map((row) => row.t);

test('numbers sort both ways, ties keep their order', () => {
  assert.deepEqual(tickers(sortBy(rows, (r) => r.v, 'desc')), ['NIO', 'PLUG', 'GRX', 'AMC', 'BBD']);
  assert.deepEqual(tickers(sortBy(rows, (r) => r.v, 'asc')), ['PLUG', 'GRX', 'NIO', 'AMC', 'BBD']);
});

test('missing values sink to the bottom in either direction', () => {
  for (const dir of ['asc', 'desc']) {
    assert.deepEqual(tickers(sortBy(rows, (r) => r.v, dir)).slice(-2), ['AMC', 'BBD']);
  }
});

test('strings sort alphabetically', () => {
  assert.deepEqual(tickers(sortBy(rows, (r) => r.t, 'asc')), ['AMC', 'BBD', 'GRX', 'NIO', 'PLUG']);
});

test('booleans sort as numbers and the input is not mutated', () => {
  const copy = [...rows];
  assert.deepEqual(tickers(sortBy(rows, (r) => r.v === 3, 'desc')).slice(0, 2), ['PLUG', 'GRX']);
  assert.deepEqual(rows, copy);
});
