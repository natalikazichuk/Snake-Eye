/**
 * Snake Eye — IBKR normalisation tests.
 *
 * These cover the mapping between Interactive Brokers payloads and the shape
 * the scanner reads. No gateway and no credentials are needed: the payloads
 * here are hand-written in the two shapes the API returns.
 *
 *   node --test tests/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPayload,
  buildStockRecord,
  normalizeFundamentals,
  normalizeHistory,
  pickContract,
} from '../scripts/lib/ibkr-normalize.mjs';

/* ---------------------------------------------------------- contract pick */

const searchRows = [
  { conid: 265598, symbol: 'AAPL', companyHeader: 'APPLE INC - NASDAQ', companyName: 'APPLE INC', description: 'NASDAQ', sections: [{ secType: 'STK' }, { secType: 'OPT' }] },
  { conid: 38708077, symbol: 'AAPL', companyHeader: 'APPLE INC - MEXI', description: 'MEXI', sections: [{ secType: 'STK' }] },
  { conid: 578561419, symbol: 'AAPU', companyHeader: 'DIREXION DAILY AAPL BULL 2X - NASDAQ', description: 'NASDAQ', sections: [{ secType: 'STK' }] },
  { conid: 999, symbol: 'AAPL', companyHeader: 'APPLE INC BOND', sections: [{ secType: 'BOND' }] },
];

test('picks the US stock listing for an exact symbol match', () => {
  const contract = pickContract(searchRows, 'AAPL');
  assert.equal(contract.conid, 265598);
  assert.equal(contract.exchange, 'NASDAQ');
  assert.equal(contract.name, 'APPLE INC');
});

test('never resolves a ticker to a similarly named leveraged ETF', () => {
  // AAPU is a 2x AAPL ETF: ingesting it as AAPL would corrupt every scan.
  const contract = pickContract(searchRows, 'AAPL');
  assert.notEqual(contract.conid, 578561419);
});

test('accepts a filtered search result that carries no sections array', () => {
  // Asking the gateway for secType=STK makes it drop `sections` from the reply.
  // Treating that as "not a stock" skipped every symbol in a real run.
  const contract = pickContract(
    [{ conid: '265598', companyHeader: 'APPLE INC - NASDAQ', companyName: 'APPLE INC', symbol: 'AAPL', description: 'NASDAQ' }],
    'AAPL',
  );
  assert.equal(contract.conid, 265598, 'a string conid is accepted and normalised to a number');
  assert.equal(contract.exchange, 'NASDAQ');
});

test('accepts a reply wrapped in results/contracts', () => {
  const contract = pickContract({ results: [{ conid: 265598, symbol: 'AAPL', description: 'NASDAQ' }] }, 'AAPL');
  assert.equal(contract.conid, 265598);
});

test('still rejects a row whose only listed section is not a stock', () => {
  assert.equal(pickContract([{ conid: 1, symbol: 'AAPL', sections: [{ secType: 'BOND' }] }], 'AAPL'), null);
});

test('returns null for a symbol with no stock listing', () => {
  assert.equal(pickContract(searchRows, 'ZZZZ'), null);
  assert.equal(pickContract(null, 'AAPL'), null);
});

/* --------------------------------------------------------------- history */

const clientPortalPayload = {
  symbol: 'AAPL',
  data: [
    { t: Date.UTC(2026, 0, 5, 14, 30), o: 10, h: 11, l: 9.5, c: 10.5, v: 1000 },
    { t: Date.UTC(2026, 0, 6, 14, 30), o: 10.5, h: 12, l: 10.2, c: 11.8, v: 2000 },
  ],
};

const parallelArrayPayload = {
  time: ['2026-01-05T14:30:00Z', '2026-01-06T14:30:00Z'],
  open: [10, 10.5],
  high: [11, 12],
  low: [9.5, 10.2],
  close: [10.5, 11.8],
  volume: [100000, 200000],
};

test('normalises the Client Portal bar shape', () => {
  const history = normalizeHistory(clientPortalPayload, { volumeFactor: 1 });
  assert.deepEqual(history.dates, ['2026-01-05', '2026-01-06']);
  assert.deepEqual(history.close, [10.5, 11.8]);
  assert.deepEqual(history.high, [11, 12]);
  assert.deepEqual(history.low, [9.5, 10.2]);
});

test('normalises the parallel-array bar shape identically', () => {
  const history = normalizeHistory(parallelArrayPayload, { volumeFactor: 1 });
  assert.deepEqual(history.dates, ['2026-01-05', '2026-01-06']);
  assert.deepEqual(history.close, [10.5, 11.8]);
});

test('applies the lot-to-share volume factor', () => {
  // The Client Portal reports US equity volume in lots; 1000 lots = 100k shares.
  const history = normalizeHistory(clientPortalPayload, { volumeFactor: 100 });
  assert.deepEqual(history.volume, [100000, 200000]);
});

test('sorts bars oldest-first and de-duplicates a repeated session', () => {
  const history = normalizeHistory({
    data: [
      { t: Date.UTC(2026, 0, 6, 14, 30), o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { t: Date.UTC(2026, 0, 5, 14, 30), o: 1, h: 2, l: 0.5, c: 1.0, v: 10 },
      { t: Date.UTC(2026, 0, 6, 14, 30), o: 1, h: 2, l: 0.5, c: 1.9, v: 30 },
    ],
  }, { volumeFactor: 1 });

  assert.deepEqual(history.dates, ['2026-01-05', '2026-01-06']);
  assert.deepEqual(history.close, [1.0, 1.9], 'the later bar for a session wins');
});

test('drops bars with missing prices instead of writing nulls into the series', () => {
  const history = normalizeHistory({
    data: [
      { t: Date.UTC(2026, 0, 5, 14, 30), o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { t: Date.UTC(2026, 0, 6, 14, 30), o: 1, h: null, l: 0.5, c: null, v: 10 },
    ],
  }, { volumeFactor: 1 });

  assert.equal(history.close.length, 1);
  assert.ok(history.close.every((value) => Number.isFinite(value)));
});

test('returns null for an unrecognised payload', () => {
  assert.equal(normalizeHistory({ error: 'no data' }), null);
  assert.equal(normalizeHistory({ data: [] }), null);
});

/* ---------------------------------------------------------- fundamentals */

test('maps IBKR ratio codes and converts percentages to ratios', () => {
  const f = normalizeFundamentals({ MKTCAP: 3.2e12, TTMREV: 4e11, TTMREVCHG: 12.5, TTMROEPCT: 145.2, PEEXCLXOR: 34.1 });
  assert.equal(f.marketCap, 3.2e12);
  assert.equal(f.revenueGrowth, 0.125, 'percent -> ratio');
  assert.equal(f.roe, 1.452);
  assert.equal(f.pe, 34.1);
});

test('missing fundamentals stay null rather than becoming zero', () => {
  const f = normalizeFundamentals({});
  assert.equal(f.eps, null);
  assert.equal(f.roe, null);
  // Zero would read as "this company earns nothing", which is a different claim.
  assert.ok(Object.values(f).every((value) => value === null));
});

test('an empty fundamentals response does not throw', () => {
  assert.deepEqual(normalizeFundamentals(null), {});
});

/* --------------------------------------------------------------- payload */

test('builds a record and payload in the shape the frontend loads', () => {
  const history = normalizeHistory(clientPortalPayload, { volumeFactor: 100 });
  const record = buildStockRecord({
    contract: { conid: 265598, ticker: 'AAPL', name: 'APPLE INC', exchange: 'NASDAQ' },
    history,
    fundamentals: {},
  });
  const payload = buildPayload([record], { barSize: '1d' });

  assert.equal(payload.meta.provider, 'IBKR');
  assert.equal(payload.meta.synthetic, false);
  assert.equal(payload.meta.firstSession, '2026-01-05');
  assert.equal(payload.meta.lastSession, '2026-01-06');
  assert.equal(payload.stocks[0].ticker, 'AAPL');
  assert.equal(payload.stocks[0].history.close.length, payload.stocks[0].history.dates.length);
});
