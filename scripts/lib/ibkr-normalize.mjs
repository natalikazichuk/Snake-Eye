/**
 * Snake Eye — Interactive Brokers response normalisation.
 *
 * Pure functions only: they turn IBKR Client Portal Web API payloads into the
 * shape `data/stocks.json` uses, with no network and no I/O, so the mapping can
 * be tested without a running gateway.
 */

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

/** Minimum bars before a symbol is worth scanning at all. */
export const MIN_BARS = 60;
/** SMA200 needs this many; below it the trend filters simply have no data. */
export const FULL_BARS = 200;

/**
 * Pick the right row out of `/iserver/secdef/search`.
 *
 * The search is fuzzy: querying AAPL also returns AAPU, AAPB, foreign listings
 * and bonds. Only an exact symbol match on a US stock listing is accepted —
 * silently ingesting a 2x leveraged ETF under the ticker you asked for would
 * poison every scan that follows.
 */
export function pickContract(rows, symbol) {
  // Some builds answer with a bare array, others wrap it.
  const list = Array.isArray(rows) ? rows : rows?.results || rows?.contracts;
  if (!Array.isArray(list)) return null;
  const wanted = symbol.toUpperCase();

  const candidates = list.filter((row) => {
    if (String(row.symbol || '').toUpperCase() !== wanted) return false;

    // `sections` is only present when the gateway returns the unfiltered
    // search. Asking for secType=STK drops it, so an absent list means "the
    // server already filtered for us", not "this is not a stock" — rejecting
    // those was skipping every symbol.
    const sections = row.sections;
    if (!Array.isArray(sections) || sections.length === 0) return true;
    return sections.some((section) => (section.secType || section.security_type) === 'STK');
  });
  if (!candidates.length) return null;

  // Prefer a US listing, then the first match the API ranked highest.
  const usExchanges = ['NASDAQ', 'NYSE', 'ARCA', 'BATS', 'AMEX', 'NYSEMKT', 'PINK'];
  const preferred =
    candidates.find((row) => usExchanges.includes(exchangeOf(row))) || candidates[0];

  const conid = preferred.conid ?? preferred.underlying_contract_id;
  if (!isNum(Number(conid))) return null;

  return {
    conid: Number(conid),
    ticker: wanted,
    name: nameOf(preferred),
    exchange: exchangeOf(preferred) || null,
  };
}

function exchangeOf(row) {
  // CP Web API puts the exchange in `description`; the MCP shape uses `exchange`.
  const direct = row.exchange || row.listingExchange || row.description;
  if (direct && !String(direct).includes(' ')) return cleanExchange(direct);
  const header = String(row.companyHeader || '');
  const dash = header.lastIndexOf(' - ');
  return dash === -1 ? null : cleanExchange(header.slice(dash + 3));
}

/** NASDAQ.NMS -> NASDAQ: venue suffixes only fragment the exchange filter. */
function cleanExchange(value) {
  const cleaned = String(value).trim().toUpperCase().split('.')[0];
  return cleaned || null;
}

function nameOf(row) {
  if (row.companyName) return row.companyName;
  const header = String(row.companyHeader || row.description || '');
  const dash = header.lastIndexOf(' - ');
  return (dash === -1 ? header : header.slice(0, dash)).trim() || row.symbol;
}

/**
 * Normalise `/iserver/marketdata/history`.
 *
 * Two payload shapes are accepted: the Client Portal one (`data: [{t,o,h,l,c,v}]`)
 * and the parallel-array shape (`time/open/high/low/close/volume`) some clients
 * return. Bars come back oldest-first either way.
 *
 * `volumeFactor` matters: the Client Portal reports US equity volume in lots,
 * so raw `v` is 100x smaller than the share count. Relative volume and every
 * volume filter depend on getting this right — see docs/IBKR.md.
 */
export function normalizeHistory(payload, { volumeFactor = 1 } = {}) {
  const bars = [];

  if (Array.isArray(payload?.data)) {
    for (const bar of payload.data) {
      bars.push({ t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
    }
  } else if (Array.isArray(payload?.time)) {
    for (let i = 0; i < payload.time.length; i += 1) {
      bars.push({
        t: payload.time[i],
        o: payload.open?.[i],
        h: payload.high?.[i],
        l: payload.low?.[i],
        c: payload.close?.[i],
        v: payload.volume?.[i],
      });
    }
  } else {
    return null;
  }

  const clean = bars
    .filter((bar) => isNum(bar.c) && isNum(bar.h) && isNum(bar.l) && bar.t !== undefined)
    .map((bar) => ({ ...bar, date: toSessionDate(bar.t) }))
    .filter((bar) => bar.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // A repeated session (the gateway sometimes returns a partial bar for today
  // alongside the settled one) keeps the later entry.
  const byDate = new Map();
  for (const bar of clean) byDate.set(bar.date, bar);
  const ordered = [...byDate.values()];
  if (!ordered.length) return null;

  return {
    dates: ordered.map((bar) => bar.date),
    close: ordered.map((bar) => round(bar.c)),
    high: ordered.map((bar) => round(bar.h)),
    low: ordered.map((bar) => round(bar.l)),
    volume: ordered.map((bar) => (isNum(bar.v) ? Math.round(bar.v * volumeFactor) : 0)),
  };
}

/** Epoch millis or an ISO timestamp -> 'YYYY-MM-DD' in US market terms. */
function toSessionDate(value) {
  const date =
    typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  // Daily bars are stamped at the open (13:30Z / 14:30Z depending on DST), so
  // the UTC date is already the trading date.
  return date.toISOString().slice(0, 10);
}

const round = (value) => Math.round(value * 10000) / 10000;

/**
 * Map IBKR fundamentals onto the app's field names.
 *
 * Fundamentals need a Refinitiv entitlement and the payload varies by gateway
 * version, so anything missing stays `null` rather than 0 — `score.js` drops
 * the fundamental sub-score entirely when nothing came through.
 */
export function normalizeFundamentals(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const pick = (...keys) => {
    for (const key of keys) {
      const value = payload[key];
      if (isNum(value)) return value;
      if (typeof value === 'string' && value.trim() !== '' && isNum(Number(value))) {
        return Number(value);
      }
    }
    return null;
  };

  const ratio = (value) => (isNum(value) ? value / 100 : null);

  return {
    marketCap: pick('marketCap', 'MKTCAP', 'mktcap'),
    revenue: pick('revenue', 'TTMREV', 'ttmrev'),
    revenueGrowth: ratio(pick('revenueGrowth', 'TTMREVCHG', 'REVCHNGYR')),
    eps: pick('eps', 'TTMEPSXCLX', 'ttmeps'),
    epsGrowth: ratio(pick('epsGrowth', 'TTMEPSCHG', 'EPSCHNGYR')),
    pe: pick('pe', 'PEEXCLXOR', 'peexclxor'),
    ps: pick('ps', 'TMPRICE2REV', 'PR2TANBK'),
    roe: ratio(pick('roe', 'TTMROEPCT')),
    debtEquity: pick('debtEquity', 'QTOTD2EQ'),
    grossMargin: ratio(pick('grossMargin', 'TTMGROSMGN')),
    operatingMargin: ratio(pick('operatingMargin', 'TTMOPMGN')),
    currentRatio: pick('currentRatio', 'QCURRATIO'),
  };
}

/** Assemble one stock record in the shape `data/stocks.json` expects. */
export function buildStockRecord({ contract, history, fundamentals, sector = null }) {
  return {
    ticker: contract.ticker,
    name: contract.name,
    exchange: contract.exchange,
    sector,
    currency: 'USD',
    conid: contract.conid,
    fundamentals: fundamentals || {},
    history: {
      dates: history.dates,
      close: history.close,
      high: history.high,
      low: history.low,
      volume: history.volume,
    },
  };
}

/** Wrap the records with the metadata the frontend reads. */
export function buildPayload(stocks, { barSize = '1d' } = {}) {
  const sessions = stocks.flatMap((stock) => stock.history.dates);
  const first = sessions.length ? sessions.reduce((a, b) => (a < b ? a : b)) : null;
  const last = sessions.length ? sessions.reduce((a, b) => (a > b ? a : b)) : null;

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      generator: 'scripts/ibkr-ingest.mjs',
      provider: 'IBKR',
      synthetic: false,
      barSize,
      bars: stocks.length ? Math.max(...stocks.map((s) => s.history.close.length)) : 0,
      firstSession: first,
      lastSession: last,
      notice:
        'End-of-day data from your own Interactive Brokers subscription. Personal use only — do not redistribute.',
    },
    stocks,
  };
}
