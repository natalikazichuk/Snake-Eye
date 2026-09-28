/**
 * Snake Eye — pull and score one symbol.
 *
 * Shared by the CLI (`npm run ticker`) and the local server's API, so typing a
 * ticker into the browser and typing it into a terminal do the same work and
 * produce the same score. Two implementations would agree on the day they were
 * written and drift afterwards.
 *
 * Nothing here prints or reads argv — callers own that.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MIN_BARS, buildStockRecord, normalizeHistory } from './ibkr-normalize.mjs';
import {
  checkAuth,
  fetchFundamentals,
  fetchHistory,
  initSession,
  lookupExchange,
  resolveContract,
  resolveGateway,
  withRetry,
} from './ibkr-client.mjs';
import { analyze } from '../../js/indicators.js';
import { scoreStock } from '../../js/score.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** A ticker, as IBKR writes them. Anything else is not worth a request. */
export const SYMBOL_PATTERN = /^[A-Z][A-Z.]{0,5}$/;

export function normalizeSymbol(input) {
  const symbol = String(input || '').trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

/**
 * Resolve, pull, score. Returns the record to store and the scored row, which
 * carry the same numbers the browser would compute from the record.
 */
export async function pullSymbol(symbol, options = {}) {
  const {
    gateway = 'https://localhost:5000',
    period = '1y',
    bar = '1d',
    volumeFactor = 100,
    debug = false,
    onStep = () => {},
  } = options;

  const base = await resolveGateway(gateway);
  await withRetry('auth', () => checkAuth(base));
  await initSession(base);

  onStep('resolving');
  const contract = await resolveContract(base, symbol, { debug });
  if (!contract) {
    throw Object.assign(
      new Error(`No US stock contract for ${symbol}.`),
      { code: 'NO_CONTRACT' },
    );
  }

  onStep('history', contract);
  const raw = await withRetry(`history ${symbol}`, () =>
    fetchHistory(base, contract.conid, { period, bar }));
  const history = normalizeHistory(raw, { volumeFactor });

  if (!history || history.close.length < MIN_BARS) {
    throw Object.assign(
      new Error(
        `Only ${history?.close.length ?? 0} bars for ${symbol}; `
        + `${MIN_BARS} are needed before the indicators mean anything.`,
      ),
      { code: 'TOO_FEW_BARS' },
    );
  }

  if (!contract.exchange) {
    contract.exchange = await lookupExchange(base, symbol);
  }

  onStep('fundamentals', contract);
  const fundamentals = await fetchFundamentals(base, contract.conid, { debug });
  const record = buildStockRecord({ contract, history, fundamentals });

  const row = {
    ticker: record.ticker,
    name: record.name,
    exchange: (record.exchange || 'UNKNOWN').toUpperCase(),
    sector: record.sector,
    fundamentals: record.fundamentals || {},
    metrics: analyze(record.history),
    dates: record.history.dates,
  };
  row.score = scoreStock(row);

  return { contract, record, row, bars: history.close.length };
}

/**
 * Merge one record into the data file, replacing any earlier copy.
 *
 * The file may not exist yet — pulling a symbol before any bulk ingest is a
 * reasonable way to start.
 */
export async function mergeIntoFile(record, { file = 'data/stocks.local.json', barSize = '1d' } = {}) {
  const path = resolve(ROOT, file);
  let payload = null;

  try {
    payload = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    payload = { meta: { provider: 'IBKR', synthetic: false, barSize }, stocks: [] };
  }
  if (!Array.isArray(payload.stocks)) payload.stocks = [];

  const index = payload.stocks.findIndex((s) => s.ticker === record.ticker);
  const replaced = index !== -1;
  if (replaced) payload.stocks[index] = record;
  else payload.stocks.push(record);

  const lastSessions = payload.stocks.map((s) => s.history?.dates?.at(-1)).filter(Boolean).sort();
  const firstSessions = payload.stocks.map((s) => s.history?.dates?.[0]).filter(Boolean).sort();

  payload.meta = {
    ...payload.meta,
    provider: payload.meta?.provider || 'IBKR',
    synthetic: false,
    generated: new Date().toISOString().slice(0, 10),
    barSize: payload.meta?.barSize || barSize,
    firstSession: firstSessions[0] || null,
    lastSession: lastSessions.at(-1) || null,
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload)}\n`);
  return { total: payload.stocks.length, replaced };
}

/** Drop one symbol from the data file. */
export async function removeFromFile(ticker, { file = 'data/stocks.local.json' } = {}) {
  const path = resolve(ROOT, file);
  let payload;
  try {
    payload = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { total: 0, removed: false };
  }
  if (!Array.isArray(payload.stocks)) return { total: 0, removed: false };

  const before = payload.stocks.length;
  payload.stocks = payload.stocks.filter((s) => String(s.ticker).toUpperCase() !== ticker);
  const removed = payload.stocks.length !== before;

  if (removed) {
    const lastSessions = payload.stocks.map((s) => s.history?.dates?.at(-1)).filter(Boolean).sort();
    payload.meta = { ...payload.meta, lastSession: lastSessions.at(-1) || null };
    await writeFile(path, `${JSON.stringify(payload)}\n`);
  }
  return { total: payload.stocks.length, removed };
}
