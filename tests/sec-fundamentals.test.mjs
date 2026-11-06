/**
 * Snake Eye — SEC fundamentals tests.
 *
 * The payloads here mirror the shape of `companyfacts`: several tags for the
 * same concept, quarterly rows mixed in with annual ones, amended filings
 * restating a year, and foreign filers using IFRS tags. Those are the cases
 * that quietly produce wrong numbers rather than obvious failures.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCikIndex, buildFundamentals, coverage, reportingCurrencies } from '../scripts/lib/sec-fundamentals.mjs';

const usd = (rows) => ({ units: { USD: rows } });
const perShare = (rows) => ({ units: { 'USD/shares': rows } });
const shares = (rows) => ({ units: { shares: rows } });

/** A filer with two clean annual years plus a quarter that must be ignored. */
const ACME = {
  cik: 1234567,
  entityName: 'ACME CORP',
  facts: {
    dei: {
      EntityCommonStockSharesOutstanding: shares([
        { end: '2025-02-01', val: 1_000_000, form: '10-K', filed: '2025-02-10' },
        { end: '2026-02-01', val: 1_200_000, form: '10-K', filed: '2026-02-10' },
      ]),
    },
    'us-gaap': {
      RevenueFromContractWithCustomerExcludingAssessedTax: usd([
        { start: '2024-01-01', end: '2024-12-31', val: 800, form: '10-K', filed: '2025-02-10', fy: 2024 },
        { start: '2025-01-01', end: '2025-12-31', val: 1000, form: '10-K', filed: '2026-02-10', fy: 2025 },
        { start: '2025-07-01', end: '2025-09-30', val: 260, form: '10-Q', filed: '2025-10-20', fy: 2025 },
      ]),
      NetIncomeLoss: usd([
        { start: '2024-01-01', end: '2024-12-31', val: 80, form: '10-K', filed: '2025-02-10' },
        { start: '2025-01-01', end: '2025-12-31', val: 120, form: '10-K', filed: '2026-02-10' },
      ]),
      EarningsPerShareDiluted: perShare([
        { start: '2024-01-01', end: '2024-12-31', val: 0.8, form: '10-K', filed: '2025-02-10' },
        { start: '2025-01-01', end: '2025-12-31', val: 1.0, form: '10-K', filed: '2026-02-10' },
      ]),
      StockholdersEquity: usd([{ end: '2025-12-31', val: 600, form: '10-K', filed: '2026-02-10' }]),
      Liabilities: usd([{ end: '2025-12-31', val: 300, form: '10-K', filed: '2026-02-10' }]),
      AssetsCurrent: usd([{ end: '2025-12-31', val: 400, form: '10-K', filed: '2026-02-10' }]),
      LiabilitiesCurrent: usd([{ end: '2025-12-31', val: 200, form: '10-K', filed: '2026-02-10' }]),
      GrossProfit: usd([{ start: '2025-01-01', end: '2025-12-31', val: 450, form: '10-K', filed: '2026-02-10' }]),
      OperatingIncomeLoss: usd([{ start: '2025-01-01', end: '2025-12-31', val: 150, form: '10-K', filed: '2026-02-10' }]),
    },
  },
};

test('reads the latest annual figures and the ratios built from them', () => {
  const f = buildFundamentals(ACME, { price: 20 });

  assert.equal(f.revenue, 1000, 'the annual figure, not the quarter');
  assert.equal(f.eps, 1.0);
  assert.equal(f.roe, 0.2, '120 / 600');
  assert.equal(f.debtEquity, 0.5, '300 / 600');
  assert.equal(f.grossMargin, 0.45);
  assert.equal(f.operatingMargin, 0.15);
  assert.equal(f.currentRatio, 2);
});

test('growth compares consecutive annual periods', () => {
  const f = buildFundamentals(ACME, { price: 20 });
  assert.equal(f.revenueGrowth, 0.25, '1000 vs 800');
  assert.equal(Math.round(f.epsGrowth * 100) / 100, 0.25, '1.0 vs 0.8');
});

test('a quarterly row never passes for an annual one', () => {
  // The 10-Q above reports 260 for three months; picking it would understate
  // revenue by a factor of four and quietly wreck every margin.
  const f = buildFundamentals(ACME, { price: 20 });
  assert.notEqual(f.revenue, 260);
});

test('market cap, P/E and P/S use the supplied price', () => {
  const f = buildFundamentals(ACME, { price: 20 });
  assert.equal(f.sharesOutstanding, 1_200_000, 'the newest share count');
  assert.equal(f.marketCap, 24_000_000);
  assert.equal(f.pe, 20, '20 / 1.0');
  assert.equal(f.ps, 24_000);
});

test('without a price those three stay null instead of being invented', () => {
  const f = buildFundamentals(ACME);
  assert.equal(f.marketCap, null);
  assert.equal(f.pe, null);
  assert.equal(f.ps, null);
  assert.equal(f.revenue, 1000, 'the filed figures are unaffected');
});

test('a loss-making company has no P/E', () => {
  const lossy = structuredClone(ACME);
  lossy.facts['us-gaap'].EarningsPerShareDiluted.units['USD/shares'] = [
    { start: '2025-01-01', end: '2025-12-31', val: -0.4, form: '10-K', filed: '2026-02-10' },
  ];
  const f = buildFundamentals(lossy, { price: 20 });
  assert.equal(f.eps, -0.4, 'the loss itself is reported');
  assert.equal(f.pe, null, 'but a negative P/E is not a number anyone wants');
});

test('an amended filing supersedes the original for the same year', () => {
  const restated = structuredClone(ACME);
  restated.facts['us-gaap'].NetIncomeLoss.units.USD.push({
    start: '2025-01-01', end: '2025-12-31', val: 90, form: '10-K/A', filed: '2026-05-01',
  });
  const f = buildFundamentals(restated, { price: 20 });
  assert.equal(f.roe, 0.15, '90 / 600 — the restatement wins on filing date');
});

test('falls back through tag aliases for older filers', () => {
  const older = { cik: 1, entityName: 'OLD CO', facts: { 'us-gaap': {
    SalesRevenueNet: usd([{ start: '2025-01-01', end: '2025-12-31', val: 500, form: '10-K', filed: '2026-02-01' }]),
    ProfitLoss: usd([{ start: '2025-01-01', end: '2025-12-31', val: 50, form: '10-K', filed: '2026-02-01' }]),
    StockholdersEquity: usd([{ end: '2025-12-31', val: 250, form: '10-K', filed: '2026-02-01' }]),
  } } };
  const f = buildFundamentals(older, { price: 10 });
  assert.equal(f.revenue, 500);
  assert.equal(f.roe, 0.2);
  assert.equal(f.source.revenueTag, 'SalesRevenueNet');
});

test('foreign issuers filing 20-F under IFRS are read too', () => {
  const foreign = { cik: 2, entityName: 'GLOBAL SA', facts: { 'ifrs-full': {
    Revenues: usd([
      { start: '2024-01-01', end: '2024-12-31', val: 2000, form: '20-F', filed: '2025-04-01' },
      { start: '2025-01-01', end: '2025-12-31', val: 2400, form: '20-F', filed: '2026-04-01' },
    ]),
  } } };
  const f = buildFundamentals(foreign, { price: 5 });
  assert.equal(f.revenue, 2400);
  assert.equal(f.revenueGrowth, 0.2);
  assert.equal(f.source.form, '20-F');
});

test('a filer with nothing usable yields nulls, never zeros', () => {
  const empty = buildFundamentals({ cik: 3, entityName: 'QUIET CO', facts: {} }, { price: 10 });
  for (const field of ['revenue', 'eps', 'roe', 'debtEquity', 'grossMargin', 'currentRatio']) {
    assert.equal(empty[field], null, `${field} must be null`);
  }
  assert.equal(coverage(empty).filled, 0);
});

test('coverage counts what actually arrived', () => {
  assert.equal(coverage(buildFundamentals(ACME, { price: 20 })).filled, 7);
});

test('the CIK index pads to the ten digits the endpoint expects', () => {
  const index = buildCikIndex({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } });
  assert.equal(index.get('AAPL'), '0000320193');
});

const year = (y, val, extra = {}) => ({ start: `${y}-01-01`, end: `${y}-12-31`, val, form: '10-K', filed: `${y + 1}-02-10`, ...extra });

test('the tag with the newest year wins over an older, higher-priority one', () => {
  // NVIDIA: RevenueFromContractWithCustomer... stops at FY2022, Revenues runs to today.
  const nvda = { cik: 1045810, entityName: 'NVIDIA CORP', facts: { 'us-gaap': {
    RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(2020, 16.7e9), year(2021, 26.9e9)]),
    Revenues: usd([year(2020, 16.7e9), year(2021, 26.9e9), year(2024, 130.5e9), year(2025, 190e9)]),
  } } };
  const f = buildFundamentals(nvda, { price: 100 });
  assert.equal(f.revenue, 190e9);
  assert.equal(f.source.revenueTag, 'Revenues');
  assert.equal(f.source.fiscalYearEnd, '2025-12-31');
});

test('figures in another currency are never read as dollars', () => {
  // NIO: CNY figures with a USD convenience translation beside them.
  const nio = { cik: 1736541, entityName: 'NIO Inc.', facts: { 'us-gaap': {
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: {
      CNY: [year(2025, 87.5e9, { form: '20-F' })],
      USD: [year(2025, 12.1e9, { form: '20-F' })],
    } },
    EarningsPerShareDiluted: { units: {
      'CNY/shares': [year(2025, -10.2, { form: '20-F' })],
      'USD/shares': [year(2025, -1.41, { form: '20-F' })],
    } },
  } } };
  const f = buildFundamentals(nio, { price: 5 });
  assert.equal(f.revenue, 12.1e9);
  assert.equal(f.eps, -1.41);
});

test('a filer reporting only in BRL gets nulls, and its 2010 US-GAAP figures are stale', () => {
  // Bradesco: US-GAAP in 2010, IFRS in BRL since.
  const bbd = { cik: 1160330, entityName: 'BANK BRADESCO', facts: {
    'us-gaap': { NetIncomeLoss: usd([year(2010, 5e9, { form: '20-F' })]) },
    'ifrs-full': { ProfitLoss: { units: { BRL: [year(2025, 20e9, { form: '20-F' })] } } },
  } };
  const f = buildFundamentals(bbd, { price: 3 });
  assert.equal(f.roe, null);
  assert.equal(coverage(f).filled, 0);
  assert.deepEqual(reportingCurrencies(bbd), ['BRL']);
});
