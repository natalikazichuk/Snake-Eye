#!/usr/bin/env node
/**
 * Snake Eye — one symbol, on demand.
 *
 *   npm run ticker -- PLUG
 *
 * Pulls a single ticker from the gateway, scores it, prints the breakdown, and
 * adds it to `data/stocks.local.json` so it shows up in the scanner too. For
 * checking something you heard about without re-running the whole universe.
 *
 * The score is computed by importing the browser's own `analyze` and
 * `scoreStock` rather than reimplementing them, so the number here is the
 * number the site shows — there is no second implementation to drift.
 *
 * Options:
 *   --gateway <url>   gateway base URL      (default https://localhost:5000)
 *   --period <p>      history window        (default 1y)
 *   --bar <b>         bar size              (default 1d)
 *   --volume-factor   lots -> shares        (default 100)
 *   --no-save         print only, leave the data file alone
 *   --file <path>     data file             (default data/stocks.local.json)
 *   --json            machine-readable output instead of the report
 *   --debug           print what the gateway answered
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FULL_BARS,
  MIN_BARS,
  buildStockRecord,
  countsAsFundamentals,
  normalizeHistory,
} from './lib/ibkr-normalize.mjs';
import {
  checkAuth,
  fetchFundamentals,
  fetchHistory,
  initSession,
  lookupExchange,
  resolveContract,
  resolveGateway,
  withRetry,
} from './lib/ibkr-client.mjs';
import { analyze } from '../js/indicators.js';
import { scoreStock } from '../js/score.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ colour */

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (tty ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = (t) => paint('1', t);
const dim = (t) => paint('2', t);
const green = (t) => paint('32', t);
const yellow = (t) => paint('33', t);
const red = (t) => paint('31', t);

/** The site colours the verdict; match it so the two read the same. */
function toneColour(tone) {
  if (tone === 'strong' || tone === 'good') return green;
  if (tone === 'neutral') return yellow;
  return red;
}

/* -------------------------------------------------------------------- args */

function parseArgs(argv) {
  const options = {
    symbol: null,
    gateway: 'https://localhost:5000',
    period: '1y',
    bar: '1d',
    volumeFactor: 100,
    file: 'data/stocks.local.json',
    save: true,
    json: false,
    debug: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--gateway': options.gateway = next().replace(/\/$/, ''); break;
      case '--period': options.period = next(); break;
      case '--bar': options.bar = next(); break;
      case '--volume-factor': options.volumeFactor = Number(next()); break;
      case '--file': options.file = next(); break;
      case '--no-save': options.save = false; break;
      case '--json': options.json = true; break;
      case '--debug': options.debug = true; break;
      case '--help': case '-h': options.help = true; break;
      default:
        if (!arg.startsWith('-') && !options.symbol) options.symbol = arg.toUpperCase();
        break;
    }
  }
  return options;
}

const HELP = `Snake Eye — one symbol, on demand

  npm run ticker -- PLUG              pull, score, and add it to the data file
  npm run ticker -- AAPL --no-save    just look, leave the file alone
  npm run ticker -- NVDA --json       machine-readable

  --gateway <url>   default https://localhost:5000
  --period <p>      default 1y          --bar <b>   default 1d
  --volume-factor   default 100         --file      default data/stocks.local.json
  --debug           show what the gateway answered
`;

/* ------------------------------------------------------------------ report */

function formatMoney(value) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString('en-US')}`;
}

const num = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : '—');
const pct = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—');

/** A 0–100 value as a 20-cell bar, so the components compare at a glance. */
function bar(score, width = 20) {
  const filled = Math.round((Math.max(0, Math.min(100, score)) / 100) * width);
  return `${'█'.repeat(filled)}${dim('░'.repeat(width - filled))}`;
}

function printReport(row, { contract, bars, saved, file }) {
  const { score, metrics } = row;
  const colour = toneColour(score.tone);
  const change = metrics.changePercent;
  const changeText = Number.isFinite(change)
    ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
    : '—';

  console.log('');
  console.log(`  ${bold(row.ticker)}  ${row.name}`);
  console.log(dim(`  ${row.exchange} · conid ${contract.conid} · ${bars} bars · last ${row.dates.at(-1)}`));
  console.log('');
  console.log(`  $${num(metrics.price, 4)}   ${(change >= 0 ? green : red)(changeText)}`);
  console.log('');
  console.log(`  ${bold('SNAKE SCORE')}  ${colour(bold(String(score.total).padStart(3)))} / 100   ${colour(score.label)}`);
  console.log('');

  for (const [key, component] of Object.entries(score.components)) {
    const weight = `${Math.round(score.weights[key] * 100)}%`;
    console.log(`  ${key.padEnd(12)} ${bar(component.score)} ${String(component.score).padStart(3)}  ${dim(`weight ${weight}`)}`);
    for (const item of component.items) {
      const got = item.points === item.max ? green('●') : item.points === 0 ? dim('○') : yellow('◐');
      const detail = item.detail ? dim(`  ${item.detail}`) : '';
      console.log(`      ${got} ${item.label.padEnd(32)} ${String(item.points).padStart(5)} / ${item.max}${detail}`);
    }
    console.log('');
  }

  if (!score.fundamentalsAvailable) {
    console.log(dim('  No fundamentals for this symbol, so the score is weighted across the'));
    console.log(dim('  three available components. npm run fundamentals fills them from SEC.'));
    console.log('');
  }

  console.log(dim('  RSI      ') + num(metrics.rsi14, 1).padStart(7)
    + dim('     MACD hist ') + num(metrics.macdHistogram, 3).padStart(8)
    + dim('     ADX ') + num(metrics.adx, 0).padStart(4));
  console.log(dim('  Rel vol  ') + num(metrics.relativeVolume, 2).padStart(7)
    + dim('     ATR %      ') + num(metrics.atrPercent, 2).padStart(8)
    + dim('     %B  ') + num(metrics.bbPercentB, 2).padStart(4));

  const f = row.fundamentals;
  if (countsAsFundamentals(f)) {
    console.log('');
    console.log(dim('  Mkt cap  ') + formatMoney(f.marketCap).padStart(7)
      + dim('     P/E        ') + (Number.isFinite(f.pe) ? num(f.pe, 1) : 'n/a').padStart(8)
      + dim('     ROE ') + pct(f.roe).padStart(4));
  }

  console.log('');
  console.log(saved
    ? green(`  ✓ added to ${file} — reload Snake Eye to see it`)
    : dim('  not saved (--no-save)'));
  console.log('');
}

/* -------------------------------------------------------------------- save */

/**
 * Merge one symbol into the data file, replacing any earlier copy of it. The
 * file may not exist yet — pulling one ticker before any bulk ingest is a
 * reasonable way to start.
 */
async function save(record, { file, barSize }) {
  const path = resolve(ROOT, file);
  let payload = null;

  try {
    payload = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    payload = { meta: { source: 'ibkr', synthetic: false, barSize }, stocks: [] };
  }
  if (!Array.isArray(payload.stocks)) payload.stocks = [];

  const index = payload.stocks.findIndex((s) => s.ticker === record.ticker);
  if (index === -1) payload.stocks.push(record);
  else payload.stocks[index] = record;

  const sessions = payload.stocks
    .map((s) => s.history?.dates?.at(-1))
    .filter(Boolean)
    .sort();
  payload.meta = {
    ...payload.meta,
    generated: new Date().toISOString().slice(0, 10),
    barSize: payload.meta?.barSize || barSize,
    firstSession: payload.stocks
      .map((s) => s.history?.dates?.[0])
      .filter(Boolean)
      .sort()[0] || null,
    lastSession: sessions.at(-1) || null,
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload)}\n`);
  return payload.stocks.length;
}

/* -------------------------------------------------------------------- main */

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.symbol) {
    console.log(HELP);
    if (!options.symbol && !options.help) process.exitCode = 1;
    return;
  }

  options.gateway = await resolveGateway(options.gateway);
  await withRetry('auth', () => checkAuth(options.gateway));
  await initSession(options.gateway);

  const contract = await resolveContract(options.gateway, options.symbol, { debug: options.debug });
  if (!contract) {
    throw new Error(`No US stock contract for ${options.symbol}. Check the ticker, or try --debug.`);
  }

  // Printed before the history request, not after: a ticker can collide with a
  // futures or index contract of the same letters, and seeing which one was
  // chosen turns an opaque HTTP 500 into an obvious wrong pick.
  console.log(dim(`  ${contract.ticker} → ${contract.name} · ${contract.exchange || 'exchange unknown'} · conid ${contract.conid}`));

  const raw = await withRetry(`history ${options.symbol}`, () =>
    fetchHistory(options.gateway, contract.conid, options));
  const history = normalizeHistory(raw, { volumeFactor: options.volumeFactor });

  if (!history || history.close.length < MIN_BARS) {
    throw new Error(
      `Only ${history?.close.length ?? 0} bars for ${options.symbol}; `
      + `${MIN_BARS} are needed before the indicators mean anything.`,
    );
  }

  if (!contract.exchange) {
    contract.exchange = await lookupExchange(options.gateway, options.symbol);
  }

  const fundamentals = await fetchFundamentals(options.gateway, contract.conid, { debug: options.debug });
  const record = buildStockRecord({ contract, history, fundamentals });

  // Scored by the browser's own modules, so this number and the site's are the
  // same number rather than two implementations that agree for now.
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

  let saved = false;
  if (options.save) {
    await save(record, { file: options.file, barSize: options.bar });
    saved = true;
  }

  if (options.json) {
    console.log(JSON.stringify({
      ticker: row.ticker, name: row.name, exchange: row.exchange,
      price: row.metrics.price, changePercent: row.metrics.changePercent,
      score: row.score, fundamentals: row.fundamentals, bars: history.close.length,
      lastSession: row.dates.at(-1), saved,
    }, null, 2));
    return;
  }

  printReport(row, {
    contract,
    bars: history.close.length,
    saved,
    file: options.file,
  });

  if (history.close.length < FULL_BARS) {
    console.log(dim(`  Fewer than ${FULL_BARS} bars, so SMA200 is not available yet.`));
    console.log('');
  }
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  if (error.body) console.error(`  gateway said: ${error.body}`);

  if (error.status === 403) {
    console.error('  403 — the gateway is running but not logged in. Open https://localhost:5000.');
  } else if (error.status === 500) {
    console.error('  A 500 on the history endpoint usually means the contract is not a US cash');
    console.error('  equity — a futures or index contract can share a ticker with a stock. Check');
    console.error('  the line above: is that the company you meant? Re-run with --debug to see');
    console.error('  every contract the search returned.');
  } else if (error.code === 'ECONNREFUSED') {
    console.error('  Nothing is listening there — start the gateway, then npm run gateway.');
  }
  process.exitCode = 1;
});
