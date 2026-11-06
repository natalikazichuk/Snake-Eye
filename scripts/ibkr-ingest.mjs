#!/usr/bin/env node
/**
 * Snake Eye — Interactive Brokers ingest.
 *
 * Pulls daily bars (and fundamentals when your account is entitled to them)
 * for the symbols in `config/universe.json` and writes `data/stocks.local.json`
 * — the file the frontend prefers over the bundled demo universe.
 *
 * Runs against the IBKR Client Portal Gateway on your own machine, so the data
 * never leaves it and your credentials never touch this repository.
 *
 *   1. Start the gateway:  ./bin/run.sh root/conf.yaml
 *   2. Log in at:          https://localhost:5000
 *   3. node scripts/ibkr-ingest.mjs
 *
 * Options:
 *   --universe <path>     symbol list           (default config/universe.json)
 *   --out <path>          output file           (default data/stocks.local.json)
 *   --gateway <url>       gateway base URL      (default https://localhost:5000)
 *   --period <p>          history window        (default 1y)
 *   --bar <b>             bar size              (default 1d)
 *   --volume-factor <n>   see docs/IBKR.md      (default 100)
 *   --delay <ms>          pause between calls   (default 1200)
 *   --limit <n>           only the first n symbols (a quick smoke test)
 *   --fresh-days <n>      skip symbols not traded in n days (default 7)
 *   --include-stale       keep symbols that have stopped trading
 *   --restart             ignore saved progress, start from the first symbol
 *
 * An interrupted run resumes: progress is saved beside the output every few
 * symbols, and the same command run again continues where it stopped.
 *   --no-fundamentals     skip the fundamentals request entirely
 *   --dry-run             resolve nothing, just print the plan
 *
 * See docs/IBKR.md for pacing, entitlements and troubleshooting.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FRESH_DAYS,
  FULL_BARS,
  MIN_BARS,
  daysSinceLastBar,
  buildPayload,
  buildStockRecord,
  carryFundamentals,
  countsAsFundamentals,
  normalizeHistory,
} from './lib/ibkr-normalize.mjs';
import {
  checkAuth,
  createPacer,
  feedReport,
  fetchFundamentals,
  fetchHistory,
  initSession,
  lookupExchange,
  resolveContract,
  resolveGateway,
  withRetry,
} from './lib/ibkr-client.mjs';
import {
  clearProgress,
  loadProgress,
  progressPath,
  saveProgress,
  settledSymbols,
} from './lib/ingest-progress.mjs';

/** Save progress after this many symbols — at most this many are lost to a power cut. */
const CHECKPOINT_EVERY = 10;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------- args */

function parseArgs(argv) {
  const options = {
    universe: 'config/universe.json',
    out: 'data/stocks.local.json',
    gateway: 'https://localhost:5000',
    period: '1y',
    bar: '1d',
    volumeFactor: 100,
    delay: 1200,
    limit: null,
    freshDays: FRESH_DAYS,
    restart: false,
    fundamentals: true,
    dryRun: false,
    debug: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--universe': options.universe = next(); break;
      case '--out': options.out = next(); break;
      case '--gateway': options.gateway = next(); break;
      case '--period': options.period = next(); break;
      case '--bar': options.bar = next(); break;
      case '--volume-factor': options.volumeFactor = Number(next()); break;
      case '--delay': options.delay = Number(next()); break;
      case '--limit': options.limit = Number(next()); break;
      case '--fresh-days': options.freshDays = Number(next()); break;
      case '--include-stale': options.freshDays = 0; break;
      case '--restart': options.restart = true; break;
      case '--no-fundamentals': options.fundamentals = false; break;
      case '--dry-run': options.dryRun = true; break;
      case '--debug': options.debug = true; break;
      case '--help':
      case '-h':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }
  if (!Number.isFinite(options.freshDays) || options.freshDays < 0) {
    console.error('--fresh-days needs a number of days, e.g. --fresh-days 7');
    process.exit(1);
  }
  return options;
}

const HELP = `Snake Eye — IBKR ingest

  node scripts/ibkr-ingest.mjs [options]

  --universe <path>    symbol list (default config/universe.json)
  --out <path>         output file (default data/stocks.local.json)
  --gateway <url>      Client Portal Gateway (default https://localhost:5000)
  --period <p>         1y, 2y, 6m …            --bar <b>  1d, 1w …
  --volume-factor <n>  lots -> shares (default 100, see docs/IBKR.md)
  --delay <ms>         pause between requests (default 1200)
  --limit <n>          only the first n symbols
  --fresh-days <n>     skip symbols whose last bar is older than n days (default ${FRESH_DAYS})
  --include-stale      keep them anyway
  --restart            ignore saved progress and start from the first symbol
  --no-fundamentals    skip fundamentals

An interrupted run resumes: progress is saved every ${CHECKPOINT_EVERY} symbols, and running
the same command again continues from where it stopped.
  --dry-run            print the plan without calling the gateway
  --debug              print the raw gateway reply when a symbol cannot be resolved
`;

/* ------------------------------------------------------------------- http */

async function loadUniverse(path) {
  const raw = await readFile(resolve(ROOT, path), 'utf8');
  const parsed = JSON.parse(raw);
  const symbols = Array.isArray(parsed) ? parsed : parsed.symbols;
  if (!Array.isArray(symbols) || !symbols.length) {
    throw new Error(`${path} contains no symbols`);
  }
  return [...new Set(symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let symbols = await loadUniverse(options.universe);
  if (options.limit) symbols = symbols.slice(0, options.limit);

  console.log(`🐍 Snake Eye — IBKR ingest`);
  console.log(`   universe : ${symbols.length} symbols (${options.universe})`);
  console.log(`   history  : ${options.period} of ${options.bar} bars`);
  console.log(`   gateway  : ${options.gateway}`);
  console.log(`   output   : ${options.out}`);

  if (options.dryRun) {
    console.log(`\nDry run — would request ${symbols.length * (options.fundamentals ? 3 : 2)} calls:`);
    console.log(`   ${symbols.join(', ')}`);
    const minutes = ((symbols.length * options.delay) / 60000).toFixed(1);
    console.log(`\nEstimated run time at --delay ${options.delay}: ~${minutes} min (plus pacing waits).`);
    return;
  }

  options.gateway = await withRetry('gateway', () => resolveGateway(options.gateway));
  await withRetry('auth', () => checkAuth(options.gateway));
  const accountCount = await initSession(options.gateway);
  console.log(`   auth     : ok${accountCount ? ` (${accountCount} account${accountCount > 1 ? 's' : ''})` : ''}\n`);

  const progressFile = resolve(ROOT, progressPath(options.out));
  if (options.restart) await clearProgress(progressFile);
  const { state, reason } = await loadProgress(progressFile, {
    period: options.period, bar: options.bar, volumeFactor: options.volumeFactor,
  });
  if (reason) console.log(`   progress : ${reason}`);

  // Only what is still on the list carries over; a symbol dropped from the
  // list since the interrupted run is not resurrected.
  const listed = new Set(symbols);
  const stocks = (state?.stocks || []).filter((stock) => listed.has(String(stock.ticker).toUpperCase()));
  // [symbol, reason, lasting] — lasting skips are saved and not retried;
  // failures on an error are reported but retried by the next run.
  const skipped = (state?.skipped || [])
    .filter(([symbol]) => listed.has(String(symbol).toUpperCase()))
    .map(([symbol, why]) => [symbol, why, true]);
  const settled = settledSymbols({ stocks, skipped });
  const run = state?.run || {
    period: options.period, bar: options.bar, volumeFactor: options.volumeFactor,
    startedAt: new Date().toISOString(),
  };

  if (settled.size) {
    console.log(`   resuming : ${settled.size} of ${symbols.length} already done ` +
      `(${stocks.length} pulled, ${skipped.length} skipped) — continuing with the rest\n`);
  }

  const checkpoint = () => saveProgress(progressFile, {
    run,
    stocks,
    skipped: skipped.filter(([, , lasting]) => lasting).map(([symbol, why]) => [symbol, why]),
  });

  const pace = createPacer({ delay: options.delay });
  let sinceCheckpoint = 0;

  for (const [index, symbol] of symbols.entries()) {
    if (settled.has(symbol)) continue;
    const position = `[${String(index + 1).padStart(3)}/${symbols.length}]`;

    if (sinceCheckpoint >= CHECKPOINT_EVERY) {
      await checkpoint();
      sinceCheckpoint = 0;
    }
    sinceCheckpoint += 1;

    try {
      await pace();
      const contract = await withRetry(`search ${symbol}`, () =>
        resolveContract(options.gateway, symbol, { debug: options.debug }));
      if (options.debug && contract) {
        console.log(`      resolved ${symbol}: ${JSON.stringify(contract)}`);
      }
      if (!contract) {
        skipped.push([symbol, 'no matching US stock contract', true]);
        console.log(`${position} ${symbol.padEnd(6)} — skipped (no contract)`);
        continue;
      }

      await pace();
      const raw = await withRetry(`history ${symbol}`, () =>
        fetchHistory(options.gateway, contract.conid, options));
      const history = normalizeHistory(raw, { volumeFactor: options.volumeFactor });

      if (!history || history.close.length < MIN_BARS) {
        skipped.push([symbol, `only ${history?.close.length ?? 0} bars`, Boolean(history)]);
        console.log(`${position} ${symbol.padEnd(6)} — skipped (too little history)`);
        continue;
      }

      // A suspended or delisted symbol still answers with history; it just
      // stops. Scanning it would rank a stock nobody can trade.
      const lag = daysSinceLastBar(history.dates.at(-1));
      if (options.freshDays && lag !== null && lag > options.freshDays) {
        skipped.push([symbol, `not trading: last bar ${history.dates.at(-1)}, ${lag} days ago`, true]);
        console.log(`${position} ${symbol.padEnd(6)} — skipped (last traded ${history.dates.at(-1)})`);
        continue;
      }

      if (!contract.exchange) {
        await pace();
        contract.exchange = await lookupExchange(options.gateway, symbol);
      }

      let fundamentals = {};
      if (options.fundamentals) {
        await pace();
        fundamentals = await fetchFundamentals(options.gateway, contract.conid, { debug: options.debug });
      }

      stocks.push(buildStockRecord({ contract, history, fundamentals }));

      const short = history.close.length < FULL_BARS ? ' (no SMA200 yet)' : '';
      console.log(
        `${position} ${symbol.padEnd(6)} ${(contract.exchange || 'UNKNOWN').padEnd(7)} ` +
        `${String(history.close.length).padStart(4)} bars  ` +
        `last ${history.dates.at(-1)}  $${history.close.at(-1)}${short}`,
      );
    } catch (error) {
      skipped.push([symbol, error.message, false]);
      console.log(`${position} ${symbol.padEnd(6)} — failed: ${error.message}`);
    }
  }

  await checkpoint();

  if (!stocks.length) {
    if (skipped.every(([, reason]) => reason.includes('no matching'))) {
      console.error('\nEvery symbol failed to resolve. Re-run with --debug to see what the gateway');
      console.error('actually returns, and check that https://localhost:5000 is still logged in.');
    }
    throw new Error('No symbols were ingested — nothing written. See the errors above.');
  }

  const outPath = resolve(ROOT, options.out);

  // A fresh pull without the Refinitiv entitlement has no fundamentals; keep the
  // ones `npm run fundamentals` wrote into this file instead of erasing them.
  let previous = null;
  try {
    previous = JSON.parse(await readFile(outPath, 'utf8'));
  } catch {
    // first ingest, or an unreadable file: nothing to carry over
  }
  const earlier = new Map((previous?.stocks || []).map((s) => [s.ticker, s.fundamentals]));
  let carried = 0;
  for (const stock of stocks) {
    const before = countsAsFundamentals(stock.fundamentals);
    stock.fundamentals = carryFundamentals(stock.fundamentals, earlier.get(stock.ticker));
    if (!before && countsAsFundamentals(stock.fundamentals)) carried += 1;
  }

  const payload = buildPayload(stocks, { barSize: options.bar });
  if (carried && previous?.meta?.fundamentalsProvider) {
    payload.meta.fundamentalsProvider = previous.meta.fundamentalsProvider;
    payload.meta.fundamentalsUpdated = previous.meta.fundamentalsUpdated;
  }
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(payload)}\n`);

  // The run is complete only when every symbol was either pulled or skipped for
  // a lasting reason. Failures keep the progress file, so running the command
  // again retries just those.
  const failed = skipped.filter(([, , lasting]) => !lasting);
  if (failed.length) {
    console.log(`\n   ${failed.length} symbol(s) failed on an error. Run the same command again to retry`);
    console.log('   only those — everything else is kept.');
  } else {
    await clearProgress(progressFile);
  }

  const withFundamentals = stocks.filter((s) => countsAsFundamentals(s.fundamentals)).length;
  const withRatios = stocks.filter((s) => s.fundamentals.revenue !== null && s.fundamentals.revenue !== undefined).length;
  const sampleVolume = stocks[0].history.volume.at(-1);

  console.log(`\n✓ ${stocks.length} symbols written to ${options.out}`);
  console.log(`   sessions      : ${payload.meta.firstSession} → ${payload.meta.lastSession}`);
  console.log(`   fundamentals  : ${withFundamentals}/${stocks.length} symbols (${withRatios} with revenue and margins)`);
  if (carried) console.log(`   kept from the last SEC fill: ${carried} symbols`);
  if (options.fundamentals && withFundamentals === 0) {
    if (!feedReport.snapshotFundamentals && !feedReport.refinitivAnswered) {
      console.log('');
      console.log('   The gateway never sent market cap, P/E or EPS for any symbol, and no');
      console.log('   Refinitiv path answered. Those come from the fundamentals feed, not the');
      console.log('   price feed, so this is the entitlement rather than a request asked wrongly.');
      console.log('');
      console.log('   Switch it on (free for IBKR clients, but off by default):');
      console.log('     Client Portal -> Settings -> Account Settings -> Market Data Subscriptions');
      console.log('     -> Reuters/Refinitiv Worldwide Fundamentals');
      console.log('   Then restart the gateway and log in again. A paper account does not always');
      console.log('   mirror the live account\'s entitlements.');
      console.log('');
      console.log('   Meanwhile, the filings themselves are free and need no account:');
      console.log('     npm run fundamentals -- --contact you@example.com');
    } else {
      console.log('                   none came back — re-run with --debug to see what the');
      console.log('                   gateway answers, or fill them from SEC: npm run fundamentals');
    }
  }
  console.log(`   sanity check  : ${stocks[0].ticker} last volume ${sampleVolume.toLocaleString('en-US')}`);
  console.log(`                   if that is 100x off, re-run with --volume-factor ${options.volumeFactor === 100 ? 1 : 100}`);
  const unknownVenue = stocks.filter((stock) => !stock.exchange || stock.exchange === 'UNKNOWN');
  if (unknownVenue.length) {
    console.log(`\n   ⚠ exchange unresolved for ${unknownVenue.length} symbol(s): ${unknownVenue.map((s) => s.ticker).join(', ')}`);
    console.log('     They still scan fine and appear under UNKNOWN in the exchange filter.');
    console.log('     Re-run with --debug to see what the gateway returns for them.');
  }

  if (skipped.length) {
    console.log(`\n   skipped ${skipped.length}:`);
    for (const [symbol, reason] of skipped) console.log(`     ${symbol.padEnd(6)} ${reason}`);
  }
  console.log('\nReload Snake Eye — it picks up the local file automatically.');
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  if (error.message.includes('ECONNREFUSED')) {
    console.error('  The Client Portal Gateway does not appear to be running on that address.');
    console.error('  Start it, log in at https://localhost:5000, then re-run. See docs/IBKR.md.');
  }
  process.exitCode = 1;
});
