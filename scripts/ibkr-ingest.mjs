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
 *   --no-fundamentals     skip the fundamentals request entirely
 *   --dry-run             resolve nothing, just print the plan
 *
 * See docs/IBKR.md for pacing, entitlements and troubleshooting.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import http from 'node:http';

import {
  FULL_BARS,
  MIN_BARS,
  buildPayload,
  buildStockRecord,
  normalizeFundamentals,
  normalizeHistory,
  pickContract,
} from './lib/ibkr-normalize.mjs';

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
  --no-fundamentals    skip fundamentals
  --dry-run            print the plan without calling the gateway
  --debug              print the raw gateway reply when a symbol cannot be resolved
`;

/* ------------------------------------------------------------------- http */

/**
 * Headers the gateway is verified to accept — deliberately close to what curl
 * sends, since curl demonstrably works against it.
 *
 * No Origin and no Referer: supplying them makes the gateway treat the call as
 * cross-origin and refuse it, and they buy nothing for a local client.
 */
function apiHeaders() {
  return {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': 'snake-eye/0.2',
  };
}

/**
 * The gateway serves HTTPS with a self-signed certificate on localhost, so
 * verification is disabled for this one connection only — never globally, and
 * never for a remote host.
 */
function request(url, { timeout = 30000, method = 'GET', body = null } = {}) {
  const target = new URL(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(target.hostname);
  const transport = target.protocol === 'http:' ? http : https;
  const payload = body === null ? null : JSON.stringify(body);

  return new Promise((resolvePromise, reject) => {
    const req = transport.request(
      target,
      {
        method,
        headers: {
          ...apiHeaders(),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        rejectUnauthorized: !(isLocal && target.protocol === 'https:'),
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(Object.assign(new Error(`HTTP ${res.statusCode} for ${target.pathname}`), {
              status: res.statusCode,
              body: body.slice(0, 300),
            }));
            return;
          }
          try {
            resolvePromise(body ? JSON.parse(body) : null);
          } catch {
            reject(new Error(`Non-JSON response from ${target.pathname}: ${body.slice(0, 120)}`));
          }
        });
      },
    );

    req.setTimeout(timeout, () => req.destroy(new Error(`Timeout after ${timeout}ms: ${target.pathname}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * IBKR documents a pacing limit of roughly 60 historical-data requests per
 * 10 minutes. Exceeding it gets the session throttled, so the limiter waits
 * rather than letting the run trip it.
 */
function createPacer({ delay, windowMs = 10 * 60 * 1000, maxInWindow = 60 }) {
  const stamps = [];
  return async function pace() {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > windowMs) stamps.shift();

    if (stamps.length >= maxInWindow) {
      const wait = windowMs - (now - stamps[0]) + 250;
      console.log(`   … pacing limit reached, waiting ${Math.ceil(wait / 1000)}s`);
      await sleep(wait);
      return pace();
    }
    stamps.push(Date.now());
    if (delay) await sleep(delay);
  };
}

/** One retry pass with backoff — transient gateway hiccups are common. */
async function withRetry(label, fn, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) break;
      if (attempt < attempts) await sleep(1000 * 2 ** attempt);
    }
  }
  throw Object.assign(lastError || new Error(`${label} failed`), { label });
}

/* ------------------------------------------------------------- gateway API */

/**
 * On Windows `localhost` resolves to ::1 first, and the gateway's default
 * conf.yaml allows only 127.0.0.1 — so a valid request comes back 403 while the
 * browser, which reaches it over IPv4, works fine. Fall back to the IPv4
 * loopback rather than reporting a broken gateway.
 */
async function resolveGateway(gateway) {
  try {
    await request(`${gateway}/v1/api/iserver/auth/status`);
    return gateway;
  } catch (error) {
    const url = new URL(gateway);
    if (error.status !== 403 || url.hostname !== 'localhost') throw error;

    url.hostname = '127.0.0.1';
    const ipv4 = url.toString().replace(/\/$/, '');
    try {
      await request(`${ipv4}/v1/api/iserver/auth/status`);
      console.log(`   note     : localhost was refused (403); using ${ipv4}`);
      return ipv4;
    } catch {
      // Both addresses refused: this build answers 403 until a browser session
      // exists, so the fix is a login, not a different address.
      throw new Error(
        `Gateway is running but not logged in — it answers 403 until you sign in at ${gateway}`,
      );
    }
  }
}

async function checkAuth(gateway) {
  const status = await request(`${gateway}/v1/api/iserver/auth/status`);
  if (!status?.authenticated) {
    throw new Error(
      'Gateway reachable but not authenticated. Open https://localhost:5000 in a browser and log in, then re-run.',
    );
  }
  if (status.competing) {
    console.warn('⚠ Another session is competing for this account — data may be interrupted.');
  }
  return status;
}

/**
 * Several `/iserver/*` endpoints answer with empty or error payloads until the
 * brokerage session has been initialised, and `/iserver/accounts` is what does
 * it. Authenticating in the browser is not enough on its own.
 */
async function initSession(gateway) {
  try {
    const accounts = await request(`${gateway}/v1/api/iserver/accounts`);
    const count = accounts?.accounts?.length ?? 0;
    return count;
  } catch (error) {
    console.warn(`⚠ Could not initialise the brokerage session: ${error.message}`);
    console.warn('  Symbol lookups may come back empty. Re-login at the gateway if every symbol is skipped.');
    return 0;
  }
}

/**
 * Contract lookup. Gateway builds differ: older ones take a GET with query
 * parameters, newer ones expect a POST with a JSON body, and the shape of the
 * reply varies with them. Try both before giving up on a symbol.
 */
async function resolveContract(gateway, symbol, { debug = false } = {}) {
  const attempts = [
    () => request(
      `${gateway}/v1/api/iserver/secdef/search?symbol=${encodeURIComponent(symbol)}&name=false&secType=STK`,
    ),
    () => request(`${gateway}/v1/api/iserver/secdef/search`, {
      method: 'POST',
      body: { symbol, name: false, secType: 'STK' },
    }),
  ];

  let lastPayload = null;
  for (const attempt of attempts) {
    try {
      lastPayload = await attempt();
    } catch (error) {
      lastPayload = { error: error.message };
      continue;
    }
    const picked = pickContract(lastPayload, symbol);
    if (picked) return picked;
  }

  if (debug) {
    console.log(`      raw search response for ${symbol}:`);
    console.log(`      ${JSON.stringify(lastPayload).slice(0, 800)}`);
  }
  return null;
}

async function fetchHistory(gateway, conid, { period, bar }) {
  return request(
    `${gateway}/v1/api/iserver/marketdata/history?conid=${conid}&period=${period}&bar=${bar}&outsideRth=false`,
  );
}

/**
 * The search reply does not always carry the listing exchange — some gateway
 * builds return the company name where others return the venue. `/trsrv/stocks`
 * answers with the contracts behind a symbol, each with its exchange, so an
 * unresolved venue can be filled in rather than left as UNKNOWN (which then
 * shows up as an unusable checkbox in the scanner).
 */
async function lookupExchange(gateway, symbol) {
  try {
    const payload = await request(
      `${gateway}/v1/api/trsrv/stocks?symbols=${encodeURIComponent(symbol)}`,
      { timeout: 15000 },
    );
    const entries = payload?.[symbol.toUpperCase()] || [];
    for (const entry of entries) {
      for (const contract of entry.contracts || []) {
        if (contract.isUS === false) continue;
        const venue = contract.exchange || contract.listingExchange;
        if (venue) return String(venue).toUpperCase().split('.')[0];
      }
    }
  } catch {
    /* optional lookup — UNKNOWN is survivable */
  }
  return null;
}

/**
 * Fundamentals live behind a Refinitiv entitlement and the endpoint has moved
 * between gateway versions, so several paths are tried and failure is not
 * fatal: the app simply scores without the fundamental component.
 */
async function fetchFundamentals(gateway, conid) {
  const paths = [
    `/v1/api/iserver/fundamentals/${conid}/summary`,
    `/v1/api/fundamentals/landing/${conid}`,
  ];
  for (const path of paths) {
    try {
      const payload = await request(`${gateway}${path}`, { timeout: 15000 });
      if (payload && typeof payload === 'object') return normalizeFundamentals(payload.ratios || payload);
    } catch {
      /* try the next path */
    }
  }
  return {};
}

/* -------------------------------------------------------------------- run */

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

  const pace = createPacer({ delay: options.delay });
  const stocks = [];
  const skipped = [];

  for (const [index, symbol] of symbols.entries()) {
    const position = `[${String(index + 1).padStart(3)}/${symbols.length}]`;
    try {
      await pace();
      const contract = await withRetry(`search ${symbol}`, () =>
        resolveContract(options.gateway, symbol, { debug: options.debug }));
      if (options.debug && contract) {
        console.log(`      resolved ${symbol}: ${JSON.stringify(contract)}`);
      }
      if (!contract) {
        skipped.push([symbol, 'no matching US stock contract']);
        console.log(`${position} ${symbol.padEnd(6)} — skipped (no contract)`);
        continue;
      }

      await pace();
      const raw = await withRetry(`history ${symbol}`, () =>
        fetchHistory(options.gateway, contract.conid, options));
      const history = normalizeHistory(raw, { volumeFactor: options.volumeFactor });

      if (!history || history.close.length < MIN_BARS) {
        skipped.push([symbol, `only ${history?.close.length ?? 0} bars`]);
        console.log(`${position} ${symbol.padEnd(6)} — skipped (too little history)`);
        continue;
      }

      if (!contract.exchange) {
        await pace();
        contract.exchange = await lookupExchange(options.gateway, symbol);
      }

      let fundamentals = {};
      if (options.fundamentals) {
        await pace();
        fundamentals = await fetchFundamentals(options.gateway, contract.conid);
      }

      stocks.push(buildStockRecord({ contract, history, fundamentals }));

      const short = history.close.length < FULL_BARS ? ' (no SMA200 yet)' : '';
      console.log(
        `${position} ${symbol.padEnd(6)} ${(contract.exchange || 'UNKNOWN').padEnd(7)} ` +
        `${String(history.close.length).padStart(4)} bars  ` +
        `last ${history.dates.at(-1)}  $${history.close.at(-1)}${short}`,
      );
    } catch (error) {
      skipped.push([symbol, error.message]);
      console.log(`${position} ${symbol.padEnd(6)} — failed: ${error.message}`);
    }
  }

  if (!stocks.length) {
    if (skipped.every(([, reason]) => reason.includes('no matching'))) {
      console.error('\nEvery symbol failed to resolve. Re-run with --debug to see what the gateway');
      console.error('actually returns, and check that https://localhost:5000 is still logged in.');
    }
    throw new Error('No symbols were ingested — nothing written. See the errors above.');
  }

  const payload = buildPayload(stocks, { barSize: options.bar });
  const outPath = resolve(ROOT, options.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(payload)}\n`);

  const withFundamentals = stocks.filter((s) => Object.values(s.fundamentals).some((v) => v !== null && v !== undefined)).length;
  const sampleVolume = stocks[0].history.volume.at(-1);

  console.log(`\n✓ ${stocks.length} symbols written to ${options.out}`);
  console.log(`   sessions      : ${payload.meta.firstSession} → ${payload.meta.lastSession}`);
  console.log(`   fundamentals  : ${withFundamentals}/${stocks.length} symbols`);
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
