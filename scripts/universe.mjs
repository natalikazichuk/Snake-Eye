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
  fetchPositions,
  initSession,
  resolveGateway,
  withRetry,
} from './lib/ibkr-client.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = {
    file: 'config/universe.json',
    data: 'data/stocks.local.json',
    gateway: 'https://localhost:5000',
    add: [], remove: [],
    clear: false, fromPortfolio: false, pruneData: false, help: false,
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
      case '--file': options.file = next(); break;
      case '--data': options.data = next(); break;
      case '--gateway': options.gateway = next().replace(/\/$/, ''); break;
      case '--help': case '-h': options.help = true; break;
      default: break;
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
    symbols = await writeUniverse(options.file, config, symbols);
    console.log(`\n  ${options.file} updated.`);
  }

  if (options.pruneData) await pruneData(options.data, symbols);

  report(symbols, await pulledSymbols(options.data));

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
