/**
 * Snake Eye — building the scan list from the NYSE listing.
 *
 * The rows below are copied from Nasdaq Trader's otherlisted.txt, so the
 * filter is tested against the shapes the real file uses. No network needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  commonStocks,
  exclusionReason,
  parseSnapshotPrice,
  parseSymbolDirectory,
  withinPrice,
} from '../scripts/lib/nyse-list.mjs';

const DIRECTORY = [
  'ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol',
  'A|Agilent Technologies, Inc. Common Stock|N|A|N|100|N|A',
  'AA|Alcoa Corporation Common Stock |N|AA|N|100|N|AA',
  'AAC.U|Ares Acquisition Corporation III Units, each consisting of one Class A ordinary share|N|AAC.U|N|100|N|AAC=',
  'AAC.W|Ares Acquisition Corporation III Redeemable warrants|N|AAC.WS|N|100|N|AAC+',
  'AIIA.R|AI Infrastructure Acquisition Corp. Rights|N|AIIA.R|N|100|N|AIIA^',
  'ABR$D|Arbor Realty Trust 6.375% Series D Cumulative Redeemable Preferred Stock|N|ABRpD|N|100|N|ABR-D',
  'AFGB|American Financial Group, Inc. 5.875% Subordinated Debentures due 2059|N|AFGB|N|100|N|AFGB',
  'BMNP|BitMine Immersion Technologies, Inc. 9.5% Series A Perpetual Preferred Stock|N|BMNP|N|100|N|BMNP',
  'AVAL|Grupo Aval Acciones y Valores S.A. ADR (Each representing 20 preferred shares)|N|AVAL|N|100|N|AVAL',
  'AMX|America Movil, S.A.B. de C.V. American Depositary Shares (each representing the right to receive twenty)|N|AMX|N|100|N|AMX',
  'BEP|Brookfield Renewable Partners L.P. Limited Partnership Units|N|BEP|N|100|N|BEP',
  'BF.B|Brown Forman Inc Class B Common Stock|N|BF.B|N|100|N|BF/B',
  'GLD|SPDR Gold Trust|P|GLD|Y|100|N|GLD',
  'XYZ|Some NYSE ETF|N|XYZ|Y|100|N|XYZ',
  'ZTST|Test Issue Corp|N|ZTST|N|100|Y|ZTST',
  'IWM|iShares Russell 2000 ETF|P|IWM|Y|100|N|IWM',
  'File Creation Time: 1105202608:01||||||',
].join('\n');

test('parses the directory and reads the footer as the creation time', () => {
  const { rows, created } = parseSymbolDirectory(DIRECTORY);
  assert.equal(created, '1105202608:01');
  assert.equal(rows.length, 16);
  assert.deepEqual(rows[1], { symbol: 'AA', name: 'Alcoa Corporation Common Stock', exchange: 'N', etf: false, test: false });
});

test('refuses a file whose header is not the symbol directory', () => {
  assert.throws(() => parseSymbolDirectory('Symbol|Name\nA|Agilent'), /Unexpected symbol directory header/);
  assert.throws(() => parseSymbolDirectory(''), /empty/);
});

test('keeps NYSE common stock, ADRs and partnership units', () => {
  const { rows } = parseSymbolDirectory(DIRECTORY);
  const { stocks } = commonStocks(rows);
  assert.deepEqual(stocks.map((s) => s.symbol), ['A', 'AA', 'AVAL', 'AMX', 'BEP']);
});

test('says why everything else was left out', () => {
  const { rows } = parseSymbolDirectory(DIRECTORY);
  const { skipped } = commonStocks(rows);
  assert.deepEqual(skipped, {
    unit: 1,
    warrant: 1,
    right: 1,
    'preferred or other class': 1,
    'debt or preferred': 2,
    'class share': 1,
    ETF: 1,
    'test issue': 1,
  });
});

test('other venues are not NYSE', () => {
  const { rows } = parseSymbolDirectory(DIRECTORY);
  assert.deepEqual(commonStocks(rows, { exchange: 'P' }).stocks, []);
  assert.equal(exclusionReason({ symbol: 'GLD', name: 'SPDR Gold Trust', etf: true, test: false }), 'ETF');
});

test('reads IBKR last prices, with or without the close/halt prefix', () => {
  assert.equal(parseSnapshotPrice('12.34'), 12.34);
  assert.equal(parseSnapshotPrice('C12.34'), 12.34);
  assert.equal(parseSnapshotPrice('H0.87'), 0.87);
  assert.equal(parseSnapshotPrice('1,234.50'), 1234.5);
  assert.equal(parseSnapshotPrice(19.99), 19.99);
  assert.equal(parseSnapshotPrice(''), null);
  assert.equal(parseSnapshotPrice('N/A'), null);
  assert.equal(parseSnapshotPrice('0'), null);
  assert.equal(parseSnapshotPrice(undefined), null);
});

test('price range keeps the low end and drops the high end', () => {
  const prices = [['LOW', 0.5], ['ONE', 1], ['MID', 12], ['EDGE', 20], ['HIGH', 45], ['NONE', null]];
  assert.deepEqual(withinPrice(prices, { max: 20 }), { kept: ['LOW', 'ONE', 'MID'], noPrice: ['NONE'] });
  assert.deepEqual(withinPrice(prices, { min: 1, max: 20 }).kept, ['ONE', 'MID']);
  assert.deepEqual(withinPrice(prices, { min: 20 }).kept, ['EDGE', 'HIGH']);
});
