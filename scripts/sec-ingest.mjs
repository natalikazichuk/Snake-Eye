#!/usr/bin/env node
/**
 * Snake Eye — fundamentals from SEC EDGAR.
 *
 *   npm run fundamentals -- --contact you@example.com
 *
 * Interactive Brokers serves fundamentals only with a Refinitiv entitlement, so
 * a normal IBKR ingest leaves that block empty and the Snake Score runs on
 * three components. This fills it from the filings themselves: EDGAR publishes
 * every company's reported XBRL facts, free, with no key and no account.
 *
 * It reads the file the IBKR ingest wrote, adds fundamentals to each symbol it
 * can, and writes it back. Prices are never touched.
 *
 * SEC asks that automated requests identify themselves, so `--contact` is
 * required — it goes into the User-Agent and nowhere else.
 *
 * Options:
 *   --contact <email>   required by SEC's access policy
 *   --file <path>       default data/stocks.local.json
 *   --limit <n>         only the first n symbols
 *   --delay <ms>        between requests, default 150 (SEC allows ~10/s)
 *   --debug             print the tags and filings each figure came from
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import http from 'node:http';

import { buildCikIndex, buildFundamentals, coverage } from './lib/sec-fundamentals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
};

const options = {
  contact: flag('--contact', process.env.SEC_CONTACT || ''),
  file: flag('--file', 'data/stocks.local.json'),
  limit: Number(flag('--limit', 0)),
  delay: Number(flag('--delay', 150)),
  debug: argv.includes('--debug'),
  // Overridable so the whole path can be exercised against a local stub; SEC
  // itself is unreachable from CI and from sandboxes.
  base: flag('--base', process.env.SEC_BASE || ''),
};

const SEC_INDEX = options.base
  ? `${options.base}/files/company_tickers.json`
  : 'https://www.sec.gov/files/company_tickers.json';
const SEC_FACTS = (cik) => (options.base
  ? `${options.base}/api/xbrl/companyfacts/CIK${cik}.json`
  : `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);

if (!options.contact || !options.contact.includes('@')) {
  console.error('✗ SEC requires automated requests to identify themselves.\n');
  console.error('  npm run fundamentals -- --contact you@example.com\n');
  console.error('  The address goes into the User-Agent header and nowhere else.');
  console.error('  Requests without one are refused by SEC, not by this script.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url) {
  const transport = url.startsWith('http://') ? http : https;
  return new Promise((resolvePromise, reject) => {
    const req = transport.request(
      url,
      {
        method: 'GET',
        headers: {
          // SEC's stated policy: a real contact so they can reach whoever is
          // making the requests.
          'User-Agent': `Snake Eye Scanner ${options.contact}`,
          'Accept-Encoding': 'identity',
          Accept: 'application/json',
        },
      },
      (res) => {
        if (res.statusCode === 404) {
          res.resume();
          resolvePromise(null); // company simply does not file here
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(Object.assign(new Error(`HTTP ${res.statusCode} for ${url}`), { status: res.statusCode }));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolvePromise(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Could not parse ${url}: ${error.message}`));
          }
        });
      },
    );
    req.setTimeout(45000, () => req.destroy(new Error(`Timeout for ${url}`)));
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const filePath = resolve(ROOT, options.file);
  const payload = JSON.parse(await readFile(filePath, 'utf8'));
  let stocks = payload.stocks || [];
  if (options.limit) stocks = stocks.slice(0, options.limit);

  console.log('🐍 Snake Eye — fundamentals from SEC EDGAR');
  console.log(`   file     : ${options.file}`);
  console.log(`   symbols  : ${stocks.length}`);
  console.log(`   contact  : ${options.contact}\n`);

  console.log('   fetching the ticker → CIK index…');
  const index = buildCikIndex(await get(SEC_INDEX));
  console.log(`   ${index.size.toLocaleString('en-US')} tickers known to EDGAR\n`);

  let filled = 0;
  const missing = [];

  for (const [position, stock] of stocks.entries()) {
    const label = `[${String(position + 1).padStart(3)}/${stocks.length}] ${stock.ticker.padEnd(6)}`;
    const cik = index.get(stock.ticker.toUpperCase());

    if (!cik) {
      missing.push([stock.ticker, 'not listed in EDGAR (foreign private issuer or ADR)']);
      console.log(`${label} — no CIK`);
      continue;
    }

    try {
      await sleep(options.delay);
      const facts = await get(SEC_FACTS(cik));
      if (!facts) {
        missing.push([stock.ticker, 'no XBRL facts filed']);
        console.log(`${label} — no filings`);
        continue;
      }

      const price = stock.history?.close?.at(-1) ?? null;
      const fundamentals = buildFundamentals(facts, { price });
      const found = coverage(fundamentals);

      if (found.filled === 0) {
        missing.push([stock.ticker, 'filings carry none of the fields we read']);
        console.log(`${label} — nothing usable`);
        continue;
      }

      stock.fundamentals = { ...stock.fundamentals, ...fundamentals };
      filled += 1;

      const revenue = fundamentals.revenue;
      const shown = revenue >= 1e9 ? `$${(revenue / 1e9).toFixed(1)}B` : `$${Math.round((revenue || 0) / 1e6)}M`;
      console.log(
        `${label} ${String(found.filled).padStart(2)}/${found.total} fields  ` +
        `FY ${fundamentals.source.fiscalYearEnd}  rev ${shown}  ${fundamentals.source.form}`,
      );

      if (options.debug) {
        console.log(`        tags: revenue=${fundamentals.source.revenueTag}, filed ${fundamentals.source.filed}`);
        console.log(`        ${JSON.stringify(fundamentals)}`);
      }
    } catch (error) {
      missing.push([stock.ticker, error.message]);
      console.log(`${label} — failed: ${error.message}`);
    }
  }

  if (!filled) {
    throw new Error('No fundamentals were found — nothing written.');
  }

  payload.meta = {
    ...payload.meta,
    fundamentalsProvider: 'SEC EDGAR',
    fundamentalsUpdated: new Date().toISOString(),
  };
  await writeFile(filePath, `${JSON.stringify(payload)}\n`);

  console.log(`\n✓ fundamentals added for ${filled}/${stocks.length} symbols → ${options.file}`);
  if (missing.length) {
    console.log(`\n   without fundamentals (${missing.length}):`);
    for (const [ticker, reason] of missing) console.log(`     ${ticker.padEnd(6)} ${reason}`);
    console.log('\n   Those symbols keep scoring on the three technical components.');
  }
  console.log('\nReload Snake Eye — the fundamental filters and sub-score are live for the rest.');
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  if (error.status === 403) {
    console.error('  SEC refuses requests without a real contact in the User-Agent.');
  }
  process.exitCode = 1;
});
