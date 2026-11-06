#!/usr/bin/env node
/**
 * Snake Eye — manage the scan list.
 *
 * `config/universe.json` is the list of symbols the ingest pulls. It is your
 * list, not your IBKR portfolio: Snake Eye never reads your holdings unless you
 * ask it to with --from-portfolio.
 *
 *   npm run universe                       show the list and what data exists
 *   npm run universe -- --add SMC,AAPL     add symbols
 *   npm run universe -- --remove NIO,GRAB  drop symbols
 *   npm run universe -- --clear            empty the list
 *   npm run universe -- --from-portfolio   replace it with your IBKR holdings
 *   npm run universe -- --prune-data       drop data rows no longer on the list
 *   npm run universe -- --nyse --max-price 20
 *                                          replace it with NYSE stocks under $20
 *
 * Editing the list changes nothing on its own — `npm run ingest` is what pulls
 * the data. The one exception is --prune-data, which removes rows from the data
 * file so the site stops showing symbols you have dropped, without spending a
 * single request to rebuild it.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkAuth,
  fetchAccounts,
  fetchLastPrices,
  fetchPositions,
  initSession,
  resolveConids,
  resolveGateway,
  withRetry,
} from './lib/ibkr-client.mjs';
import {
  SYMBOL_DIRECTORY_URL,
  commonStocks,
  parseSnapshotPrice,
  parseSymbolDirectory,
  withinPrice,
} from './lib/nyse-list.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = {
    file: 'config/universe.json',
    data: 'data/stocks.local.json',
    gateway: 'https://localhost:5000',
    add: [], remove: [],
    clear: false, fromPortfolio: false, pruneData: false, help: false,
    nyse: false, minPrice: null, maxPrice: null,
  };

  const price = (flag, value) => {
    const n = Number(value);
    if (value === undefined || !Number.isFinite(n) || n <= 0) {
      throw new Error(`${flag} needs a positive number, got "${value ?? ''}"`);
    }
    return n;
  };

  const symbols = (value) => String(value || '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  for (let i = 0; i < argv.length; i += 1) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case '--add': options.add.push(...symbols(next())); break;
      case '--remove': options.remove.push(...symbols(next())); break;
      case '--clear': options.clear = true; break;
      case '--from-portfolio': options.fromPortfolio = true; break;
      case '--prune-data': options.pruneData = true; break;
      case '--nyse': options.nyse = true; break;
      case '--max-price': options.maxPrice = price('--max-price', next()); break;
      case '--min-price': options.minPrice = price('--min-price', next()); break;
      case '--file': options.file = next(); break;
      case '--data': options.data = next(); break;
      case '--gateway': options.gateway = next().replace(/\/$/, ''); break;
      case '--help': case '-h': options.help = true; break;
      // An option this version does not know must not pass silently: an old
      // checkout given --nyse would otherwise just print the old list, which
      // looks like success.
      default:
        throw new Error(`Unknown option: ${argv[i]}  (npm run universe -- --help lists them)`);
    }
  }
  return options;
}

const HELP = `Snake Eye — manage the scan list (config/universe.json)

  npm run universe                       show the list and what data exists
  npm run universe -- --add SMC,AAPL     add symbols
  npm run universe -- --remove NIO,GRAB  drop symbols
  npm run universe -- --clear            empty the list
  npm run universe -- --from-portfolio   replace it with your IBKR holdings
  npm run universe -- --prune-data       drop data rows no longer on the list

  npm run universe -- --nyse --max-price 20
                                         replace it with every NYSE common stock
                                         whose last price is under $20
  npm run universe -- --nyse --min-price 1 --max-price 20
                                         the same, without stocks under $1
  npm run universe -- --nyse             every NYSE common stock, no price check

--nyse reads the public NYSE listing from Nasdaq Trader and keeps the common
stock (no ETFs, preferreds, warrants, units, rights or notes). A price filter
asks your gateway for each one's last price, in batches — a few minutes.

The list is yours to edit; it is not read from your IBKR account unless you
pass --from-portfolio. Run npm run ingest afterwards to pull the data.
`;

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeUniverse(path, config, symbols) {
  const payload = {
    ...config,
    symbols: [...new Set(symbols)].sort(),
  };
  await writeFile(resolve(ROOT, path), `${JSON.stringify(payload, null, 2)}\n`);
  return payload.symbols;
}

/** The symbols the data file actually holds, so the two can be compared. */
async function pulledSymbols(path) {
  const data = await readJson(path, null);
  if (!data || !Array.isArray(data.stocks)) return null;
  return data.stocks.map((stock) => String(stock.ticker).toUpperCase());
}

function report(symbols, pulled) {
  console.log(`\n  ${symbols.length} symbol${symbols.length === 1 ? '' : 's'} in the list:`);
  console.log(symbols.length ? `    ${symbols.join(' ')}` : '    (empty)');

  if (pulled === null) {
    console.log('\n  No data file yet — run npm run ingest.');
    return;
  }

  const listed = new Set(symbols);
  const have = new Set(pulled);
  const missing = symbols.filter((s) => !have.has(s));
  const extra = pulled.filter((s) => !listed.has(s));

  console.log(`\n  ${pulled.length} symbol${pulled.length === 1 ? '' : 's'} in the data file.`);
  if (missing.length) console.log(`    listed but not pulled : ${missing.join(' ')}   (npm run ingest)`);
  if (extra.length) console.log(`    pulled but not listed : ${extra.join(' ')}   (--prune-data drops them)`);
  if (!missing.length && !extra.length) console.log('    the two agree.');
}

/** Remove rows the list no longer names, without re-pulling anything. */
async function pruneData(path, symbols) {
  const data = await readJson(path, null);
  if (!data || !Array.isArray(data.stocks)) {
    console.log('\n  No data file to prune.');
    return;
  }

  const listed = new Set(symbols);
  const before = data.stocks.length;
  data.stocks = data.stocks.filter((stock) => listed.has(String(stock.ticker).toUpperCase()));
  const removed = before - data.stocks.length;

  if (!removed) {
    console.log('\n  Nothing to prune — every row is on the list.');
    return;
  }

  const sessions = data.stocks.map((s) => s.history?.dates?.at(-1)).filter(Boolean).sort();
  data.meta = {
    ...data.meta,
    lastSession: sessions.at(-1) || null,
    firstSession: data.stocks.map((s) => s.history?.dates?.[0]).filter(Boolean).sort()[0] || null,
  };

  await writeFile(resolve(ROOT, path), `${JSON.stringify(data)}\n`);
  console.log(`\n  Removed ${removed} row${removed === 1 ? '' : 's'}; ${data.stocks.length} left.`);
}

async function fromPortfolio(gateway) {
  const base = await resolveGateway(gateway);
  await withRetry('auth', () => checkAuth(base));
  await initSession(base);

  const accounts = await fetchAccounts(base);
  if (!accounts.length) throw new Error('The gateway returned no accounts.');

  const holdings = [];
  for (const account of accounts) {
    const positions = await fetchPositions(base, account.id);
    console.log(`  ${account.id}${account.title ? ` (${account.title})` : ''}: ${positions.length} stock position${positions.length === 1 ? '' : 's'}`);
    holdings.push(...positions);
  }

  if (!holdings.length) {
    throw new Error('No stock positions found. An empty or options-only account has nothing to seed a list with.');
  }
  return [...new Set(holdings.map((h) => h.ticker))];
}

/**
 * Every NYSE common stock, optionally only those priced inside a range.
 *
 * The listing is public; the prices come from the gateway, so a price filter
 * needs it logged in, and a run without one needs nothing at all.
 */
async function fromNyse({ gateway, minPrice, maxPrice }) {
  const response = await fetch(SYMBOL_DIRECTORY_URL, { headers: { 'User-Agent': 'snake-eye/0.2' } });
  if (!response.ok) {
    throw new Error(`Could not download the NYSE listing: HTTP ${response.status} from ${SYMBOL_DIRECTORY_URL}`);
  }
  const { rows, created } = parseSymbolDirectory(await response.text());
  const { stocks, skipped } = commonStocks(rows);

  console.log(`  NYSE listing${created ? ` (${created})` : ''}: ${stocks.length} common stocks`);
  const left = Object.entries(skipped).map(([why, n]) => `${n} ${why}`).join(', ');
  if (left) console.log(`    left out: ${left}`);

  const symbols = stocks.map((s) => s.symbol);
  const today = new Date().toISOString().slice(0, 10);

  if (minPrice === null && maxPrice === null) {
    return {
      symbols,
      label: 'NYSE common stock',
      note: `Built ${today}: ${symbols.length} NYSE common stocks from the listing, no price filter.`,
    };
  }

  const base = await resolveGateway(gateway);
  await withRetry('auth', () => checkAuth(base));
  await initSession(base);

  const progress = (what) => (done, total) => process.stdout.write(`\r  ${what}: ${done}/${total}   `);

  const conids = await resolveConids(base, symbols, { onProgress: progress('contracts') });
  process.stdout.write('\n');
  const unresolved = symbols.filter((s) => !conids.has(s));

  const byConid = await fetchLastPrices(base, [...conids.values()], {
    parse: parseSnapshotPrice,
    onProgress: progress('prices   '),
  });
  process.stdout.write('\n');

  const prices = [...conids].map(([symbol, conid]) => [symbol, byConid.get(conid) ?? null]);
  const { kept, noPrice } = withinPrice(prices, { min: minPrice, max: maxPrice });

  const range = minPrice !== null && maxPrice !== null ? `$${minPrice} to under $${maxPrice}`
    : maxPrice !== null ? `under $${maxPrice}` : `$${minPrice} or more`;
  console.log(`  ${kept.length} of ${symbols.length} priced ${range}`);
  if (unresolved.length) console.log(`    not found at IBKR (${unresolved.length}): ${unresolved.join(' ')}`);
  if (noPrice.length) console.log(`    no price came back (${noPrice.length}): ${noPrice.join(' ')}`);

  const label = minPrice !== null && maxPrice !== null ? `NYSE $${minPrice}–$${maxPrice}`
    : maxPrice !== null ? `NYSE under $${maxPrice}` : `NYSE $${minPrice}+`;
  return {
    symbols: kept,
    label,
    note: `Built ${today} from the NYSE listing and IBKR last prices: ${kept.length} of ${symbols.length} ` +
      `common stocks were ${range}. Prices move — rebuild before relying on the threshold.`,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }

  const config = await readJson(options.file, { symbols: [] });
  let symbols = Array.isArray(config.symbols)
    ? config.symbols.map((s) => String(s).toUpperCase())
    : [];

  let changed = false;
  let target = config;

  if ((options.minPrice !== null || options.maxPrice !== null) && !options.nyse) {
    throw new Error('--min-price and --max-price filter the NYSE list; add --nyse.');
  }
  if (options.minPrice !== null && options.maxPrice !== null && options.minPrice >= options.maxPrice) {
    throw new Error('--min-price must be below --max-price.');
  }

  if (options.nyse) {
    console.log('\n  Building the list from NYSE…');
    const built = await fromNyse(options);
    if (!built.symbols.length) throw new Error('No symbols passed the filter — the list was left as it was.');
    symbols = built.symbols;
    target = { ...config, listName: built.label, verified: built.note };
    changed = true;
  }

  if (options.fromPortfolio) {
    console.log('\n  Reading your IBKR positions…');
    symbols = await fromPortfolio(options.gateway);
    changed = true;
  }

  if (options.clear) {
    symbols = [];
    changed = true;
  }

  if (options.remove.length) {
    const present = new Set(symbols);
    const absent = options.remove.filter((symbol) => !present.has(symbol));
    if (absent.length) console.log(`\n  Not on the list, nothing to remove: ${absent.join(' ')}`);

    const drop = new Set(options.remove);
    const before = symbols.length;
    symbols = symbols.filter((symbol) => !drop.has(symbol));
    if (symbols.length !== before) changed = true;
  }

  if (options.add.length) {
    const before = new Set(symbols);
    symbols = [...symbols, ...options.add.filter((s) => !before.has(s))];
    changed = true;
  }

  if (changed) {
    symbols = await writeUniverse(options.file, target, symbols);
    console.log(`\n  ${options.file} updated.`);
  }

  if (options.pruneData) await pruneData(options.data, symbols);

  if (symbols.length > 100) {
    // Printing a thousand symbols helps nobody; the time the ingest will take does.
    console.log(`\n  ${symbols.length} symbols in the list.`);
    const hours = (symbols.length * 11) / 3600;
    console.log(`  The ingest paces at roughly 10 s a symbol — about ${hours.toFixed(1)} h for this list.`);
    console.log('  Run it overnight, with three years of history:');
    console.log('    npm run ingest -- --period 3y');
  } else {
    report(symbols, await pulledSymbols(options.data));
  }

  if (changed && !options.pruneData) {
    console.log('\n  Next: npm run ingest    (pulls the data for this list)');
    console.log('        npm run universe -- --prune-data    (drops rows you removed, no requests)');
  }
  console.log('');
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  if (error.status === 403) {
    console.error('  403 — the gateway is running but not logged in. Open https://localhost:5000.');
  } else if (error.code === 'ECONNREFUSED') {
    console.error('  Nothing is listening there — start the gateway, then npm run gateway.');
  }
  process.exitCode = 1;
});
