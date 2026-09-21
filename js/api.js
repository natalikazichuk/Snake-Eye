/**
 * Snake Eye — market data access.
 *
 * The MVP reads a bundled, entirely synthetic universe from `data/stocks.json`
 * (see scripts/generate-stocks.mjs). Everything above this module works on the
 * shape returned here, so swapping in a real provider later means changing
 * `fetchUniverse()` and nothing else.
 *
 * A real provider needs an API key, and an API key cannot live in frontend
 * code — anything shipped to the browser is public. Stage 4 puts a small
 * backend in front of the provider, holds the key there, and points
 * `REMOTE_ENDPOINT` at it. See docs/API.md.
 */

import { analyze } from './indicators.js';
import { hasFundamentals, scoreStock } from './score.js';

/** Resolved against this module's URL, so pages/ and the root both work. */
const STOCKS_URL = new URL('../data/stocks.json', import.meta.url);
const LOCAL_STOCKS_URL = new URL('../data/stocks.local.json', import.meta.url);
const PRESETS_URL = new URL('../data/presets.json', import.meta.url);

/**
 * Real market data pulled from Interactive Brokers lands in
 * `data/stocks.local.json` (see scripts/ibkr-ingest.mjs). That file is
 * git-ignored on purpose: it is your own subscription's data, it goes stale
 * daily, and a public repository is not the place for either. When it is
 * present it wins; otherwise the committed demo universe is used.
 */
const REMOTE_ENDPOINT = null;

let universePromise = null;
let presetsPromise = null;

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  }
  return response.json();
}

/** Business days ending at `lastSession`, oldest first, one per bar. */
function sessionDates(lastSession, count) {
  const dates = new Array(count);
  const cursor = new Date(`${lastSession}T00:00:00Z`);
  for (let i = count - 1; i >= 0; i -= 1) {
    dates[i] = cursor.toISOString().slice(0, 10);
    do {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6);
  }
  return dates;
}

/**
 * Turn a raw record into the row every other module consumes:
 * identity + fundamentals + computed indicator snapshot + Snake Score.
 */
/**
 * Older ingests stored the gateway's company header verbatim, exchange and
 * all: "CHARGEPOINT HOLDINGS INC (NYSE)". The ingest strips that now, but a
 * data file already on disk still carries it, and re-pulling twenty symbols to
 * fix a label is a poor trade against the pacing budget.
 */
function cleanName(name, ticker) {
  if (typeof name !== 'string') return ticker;
  return name.replace(/\s*\((?:NASDAQ|NYSE|ARCA|BATS|AMEX|NYSEMKT|PINK|ADR[^()]*)\)\s*$/i, '').trim() || ticker;
}

function buildRow(stock, meta) {
  const metrics = analyze(stock.history);
  const row = {
    ticker: stock.ticker,
    name: cleanName(stock.name, stock.ticker),
    exchange: (stock.exchange || 'UNKNOWN').toUpperCase(),
    sector: stock.sector,
    currency: stock.currency || 'USD',
    fundamentals: stock.fundamentals || {},
    metrics,
    dates: stock.history.dates?.length === stock.history.close.length
      ? stock.history.dates
      : sessionDates(meta.lastSession, stock.history.close.length),
  };
  row.score = scoreStock(row);
  return row;
}

/** Local IBKR snapshot if one has been ingested, otherwise the demo universe. */
async function fetchPayload() {
  if (REMOTE_ENDPOINT) return fetchJson(`${REMOTE_ENDPOINT}/universe`);

  try {
    const local = await fetchJson(LOCAL_STOCKS_URL);
    if (local?.stocks?.length) {
      local.meta = { ...local.meta, source: 'data/stocks.local.json' };
      return local;
    }
  } catch {
    // No local snapshot (the usual case on a fresh clone) — fall through.
  }

  const demo = await fetchJson(STOCKS_URL);
  demo.meta = { ...demo.meta, source: 'data/stocks.json' };
  return demo;
}

async function fetchUniverse() {
  const payload = await fetchPayload();
  const meta = payload.meta || {};
  const rows = payload.stocks.map((stock) => buildRow(stock, meta));
  rows.sort((a, b) => b.score.total - a.score.total);

  // Coverage is routinely partial: IBKR supplies no fundamentals without a
  // Refinitiv entitlement, and the SEC fill-in reaches only companies that file
  // XBRL with the SEC — which leaves out foreign private issuers and ADRs. The
  // UI needs to tell "none" from "some" to say something truthful.
  const withFundamentals = rows.filter((row) => hasFundamentals(row.fundamentals)).length;
  meta.fundamentalsCount = withFundamentals;
  meta.hasFundamentals = withFundamentals > 0;
  meta.provider = meta.provider || (meta.synthetic === false ? 'live' : 'demo');

  // The scanner builds its exchange checkboxes from this, so a provider that
  // reports ARCA or BATS is filterable instead of invisible.
  meta.exchanges = [...new Set(rows.map((row) => row.exchange))].sort();

  return { meta, rows };
}

/** One line describing where the loaded universe came from. */
export function describeSource(meta, symbolCount) {
  const provider = meta.provider === 'IBKR' ? 'Interactive Brokers' : meta.provider === 'demo' ? 'demo data' : meta.provider;
  const parts = [`${symbolCount} symbols`];
  if (meta.lastSession) parts.push(`session ${meta.lastSession}`);
  parts.push(provider);
  if (meta.provider === 'IBKR') parts.push('end of day');
  return parts.join(' · ');
}

/** Load (and cache) the scored universe. */
export function loadUniverse() {
  if (!universePromise) {
    universePromise = fetchUniverse().catch((error) => {
      universePromise = null; // let a later call retry instead of caching the failure
      throw error;
    });
  }
  return universePromise;
}

/** Load (and cache) the saved strategies from data/presets.json. */
export function loadPresets() {
  if (!presetsPromise) {
    presetsPromise = fetchJson(PRESETS_URL)
      .then((payload) => payload.presets || [])
      .catch((error) => {
        presetsPromise = null;
        throw error;
      });
  }
  return presetsPromise;
}

/** One row by ticker, or null when the symbol is not in the universe. */
export async function getStock(ticker) {
  const { rows } = await loadUniverse();
  const wanted = String(ticker || '').trim().toUpperCase();
  return rows.find((row) => row.ticker === wanted) || null;
}

/** Rows for a list of tickers, in the order given (missing symbols dropped). */
export async function getStocks(tickers) {
  const { rows } = await loadUniverse();
  const index = new Map(rows.map((row) => [row.ticker, row]));
  return tickers.map((ticker) => index.get(String(ticker).toUpperCase())).filter(Boolean);
}
