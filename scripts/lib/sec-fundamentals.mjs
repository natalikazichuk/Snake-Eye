/**
 * Snake Eye — SEC EDGAR fundamentals.
 *
 * Pure parsing of the XBRL `companyfacts` payload into the fundamentals block
 * `data/stocks.json` uses. No network, no I/O, so the mapping is testable
 * without hitting SEC at all.
 *
 * Figures come from annual filings rather than a stitched trailing twelve
 * months: a 10-K is one audited, internally consistent set of numbers, while
 * summing four quarters across restatements and amended filings quietly
 * produces figures no filing ever reported.
 */

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Tag priority per metric. Filers tag the same concept differently — a company
 * that adopted ASC 606 reports revenue as RevenueFromContractWithCustomer...,
 * an older filer as SalesRevenueNet — so each metric lists its aliases in the
 * order they should be trusted.
 */
const TAGS = {
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues',
    'Revenue', // ifrs-full
    'SalesRevenueNet',
    'SalesRevenueGoodsNet',
  ],
  netIncome: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  eps: [
    'EarningsPerShareDiluted',
    'EarningsPerShareBasicAndDiluted',
    'EarningsPerShareBasic',
    'DilutedEarningsLossPerShare', // ifrs-full
    'BasicEarningsLossPerShare',
  ],
  equity: [
    'StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    'EquityAttributableToOwnersOfParent', // ifrs-full
    'Equity',
  ],
  liabilities: ['Liabilities'],
  assetsCurrent: ['AssetsCurrent', 'CurrentAssets'],
  liabilitiesCurrent: ['LiabilitiesCurrent', 'CurrentLiabilities'],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss', 'ProfitLossFromOperatingActivities'],
  shares: ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'],
};

/**
 * The unit each metric must be in. Prices come from IBKR in dollars, so a
 * figure in any other currency would make P/E, P/S and market cap silently
 * wrong: NIO files revenue in CNY, and CNY 87.5B printed as "$87.5B" with a
 * P/E built from a dollar price over a yuan EPS. Many 20-F filers add a USD
 * convenience translation, which is read; a filer reporting only in BRL or EUR
 * gets nulls instead of numbers in the wrong currency.
 */
const UNIT = { eps: 'USD/shares', shares: 'shares' };
const unitFor = (metric) => UNIT[metric] || 'USD';

/** A series whose latest year is this much older than the filer's newest one is stale. */
const STALE_YEARS = 3;

/** Annual filings only: a 10-K, or the 20-F/40-F a foreign issuer files instead. */
const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);

/**
 * Every reported value for one concept, newest first.
 *
 * `facts` holds `us-gaap` for domestic filers and `ifrs-full` for many foreign
 * ones; `dei` carries entity-level figures such as the share count.
 */
function factsFor(companyfacts, tag, unit = null) {
  const namespaces = companyfacts?.facts || {};
  return ['us-gaap', 'ifrs-full', 'dei'].flatMap((namespace) => {
    const entry = namespaces[namespace]?.[tag];
    if (!entry?.units) return [];
    return Object.entries(entry.units)
      .filter(([name]) => unit === null || name === unit)
      .flatMap(([name, values]) => values.map((value) => ({ ...value, unit: name })));
  });
}

/** Currencies the filer reports in, other than dollars — to explain a gap. */
export function reportingCurrencies(companyfacts) {
  const found = new Set();
  for (const namespace of Object.values(companyfacts?.facts || {})) {
    for (const entry of Object.values(namespace || {})) {
      for (const unit of Object.keys(entry?.units || {})) {
        if (/^[A-Z]{3}$/.test(unit) && unit !== 'USD') found.add(unit);
      }
    }
  }
  return [...found].sort();
}

/**
 * The most recent annual figure for a concept, and the one before it.
 *
 * Duration facts (revenue, income) are matched on their period length so a
 * quarter filed inside a 10-K is not mistaken for the year. Instant facts
 * (equity, share counts) have no start date and are taken as they come.
 */
function annualSeries(companyfacts, metric) {
  let best = null;
  for (const tag of TAGS[metric]) {
    const rows = factsFor(companyfacts, tag, unitFor(metric))
      .filter((row) => ANNUAL_FORMS.has(row.form) && isNum(row.val) && row.end)
      .filter((row) => {
        if (!row.start) return true; // instant fact
        const days = (new Date(row.end) - new Date(row.start)) / 86400000;
        return days > 300 && days < 400; // a year, not a quarter
      });

    if (!rows.length) continue;

    // One period can appear several times across filings and amendments; keep
    // the latest filed version of each.
    const byPeriod = new Map();
    for (const row of rows) {
      const existing = byPeriod.get(row.end);
      if (!existing || (row.filed || '') > (existing.filed || '')) byPeriod.set(row.end, row);
    }

    // Filers switch tags over the years: NVIDIA reported revenue under
    // RevenueFromContractWithCustomer... until FY2022 and under Revenues
    // since. The first tag with any data is not the answer; the one with the
    // newest year is. Priority order only breaks a tie.
    const ordered = [...byPeriod.values()].sort((a, b) => (a.end < b.end ? 1 : -1));
    if (ordered.length && (!best || ordered[0].end > best.latest.end)) {
      best = { tag, latest: ordered[0], previous: ordered[1] || null, all: ordered };
    }
  }
  return best;
}

/** The newest period end the filer has reported anything for. */
function newestEnd(companyfacts) {
  let newest = '';
  for (const namespace of Object.values(companyfacts?.facts || {})) {
    for (const entry of Object.values(namespace || {})) {
      for (const rows of Object.values(entry?.units || {})) {
        for (const row of rows) if (row.end && row.end > newest) newest = row.end;
      }
    }
  }
  return newest || null;
}

/** Drop a series whose latest year trails the filer's newest report by years. */
function fresh(series, newest) {
  if (!series || !newest) return series;
  const years = (new Date(newest) - new Date(series.latest.end)) / (365.25 * 86400000);
  return years > STALE_YEARS ? null : series;
}

const valueOf = (series) => (series?.latest ? series.latest.val : null);

/** Year-over-year change as a ratio; null unless both years are usable. */
function growth(series) {
  const current = valueOf(series);
  const prior = series?.previous?.val;
  if (!isNum(current) || !isNum(prior) || prior === 0) return null;
  return (current - prior) / Math.abs(prior);
}

const ratio = (numerator, denominator) =>
  isNum(numerator) && isNum(denominator) && denominator !== 0 ? numerator / denominator : null;

/**
 * Build the fundamentals block.
 *
 * `price` comes from the market data ingest: market cap, P/E and P/S are the
 * only fields that need it, and they stay null without one rather than being
 * guessed.
 */
export function buildFundamentals(companyfacts, { price = null } = {}) {
  // Bradesco's last US-GAAP figures are from 2010; it has filed IFRS in BRL
  // ever since. Without this, 2010 numbers scored as current.
  const newest = newestEnd(companyfacts);
  const series = (metric) => fresh(annualSeries(companyfacts, metric), newest);

  const revenue = series('revenue');
  const netIncome = series('netIncome');
  const eps = series('eps');
  const equity = series('equity');
  const liabilities = series('liabilities');
  const assetsCurrent = series('assetsCurrent');
  const liabilitiesCurrent = series('liabilitiesCurrent');
  const grossProfit = series('grossProfit');
  const operatingIncome = series('operatingIncome');

  // The share count is an entity fact filed with the cover page, so it is the
  // freshest number available and is not restricted to annual forms.
  const sharesRows = TAGS.shares
    .flatMap((tag) => factsFor(companyfacts, tag, unitFor('shares')))
    .filter((row) => isNum(row.val))
    .sort((a, b) => ((a.end || '') < (b.end || '') ? 1 : -1));
  const shares = sharesRows[0]?.val ?? null;

  const revenueValue = valueOf(revenue);
  const epsValue = valueOf(eps);
  // Rounded to whole dollars: price * shares lands on values like
  // 1880999999.9999998, and a market cap carrying eight decimal places of
  // binary-float noise reads as false precision wherever it is printed.
  const marketCap = ratio(price, 1) !== null && isNum(shares)
    ? Math.round(price * shares)
    : null;

  return {
    marketCap,
    sharesOutstanding: shares,
    revenue: revenueValue,
    revenueGrowth: growth(revenue),
    eps: epsValue,
    epsGrowth: growth(eps),
    // A company with no positive earnings has no meaningful P/E — null, not 0.
    pe: isNum(price) && isNum(epsValue) && epsValue > 0 ? price / epsValue : null,
    ps: isNum(marketCap) && isNum(revenueValue) && revenueValue > 0 ? marketCap / revenueValue : null,
    roe: ratio(valueOf(netIncome), valueOf(equity)),
    debtEquity: ratio(valueOf(liabilities), valueOf(equity)),
    grossMargin: ratio(valueOf(grossProfit), revenueValue),
    operatingMargin: ratio(valueOf(operatingIncome), revenueValue),
    currentRatio: ratio(valueOf(assetsCurrent), valueOf(liabilitiesCurrent)),

    /** Where these numbers came from, so a surprising value can be traced. */
    source: {
      provider: 'SEC EDGAR',
      entityName: companyfacts?.entityName || null,
      cik: companyfacts?.cik ?? null,
      fiscalYearEnd: revenue?.latest?.end || netIncome?.latest?.end || null,
      form: revenue?.latest?.form || netIncome?.latest?.form || null,
      filed: revenue?.latest?.filed || netIncome?.latest?.filed || null,
      revenueTag: revenue?.tag || null,
    },
  };
}

/** How many of the headline fields actually came back with a number. */
export function coverage(fundamentals) {
  const fields = ['revenue', 'eps', 'roe', 'debtEquity', 'grossMargin', 'operatingMargin', 'currentRatio'];
  const filled = fields.filter((field) => isNum(fundamentals?.[field]));
  return { filled: filled.length, total: fields.length, fields: filled };
}

/** ticker -> CIK, padded the way the companyfacts endpoint expects. */
export function buildCikIndex(companyTickers) {
  const index = new Map();
  for (const row of Object.values(companyTickers || {})) {
    if (!row?.ticker || row.cik_str === undefined) continue;
    index.set(String(row.ticker).toUpperCase(), String(row.cik_str).padStart(10, '0'));
  }
  return index;
}
