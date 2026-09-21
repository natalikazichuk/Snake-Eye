#!/usr/bin/env node
/**
 * Snake Eye — IBKR snapshot field probe.
 *
 * The Client Portal snapshot endpoint identifies fields by number, and the
 * published numbering does not match every gateway build: this project shipped
 * `7282` mapped to "Category" while the gateway answered it with an average
 * volume. Rather than guess again, ask one contract for a whole block of field
 * ids and print what comes back, so the mapping is read off the gateway in
 * front of you.
 *
 *   node scripts/ibkr-fields.mjs --symbol PLUG
 *
 * Options:
 *   --symbol <ticker>   contract to probe        (default PLUG)
 *   --conid <id>        skip the symbol lookup
 *   --gateway <url>     gateway base URL         (default https://localhost:5000)
 *   --from <id>         first field id           (default 7280)
 *   --to <id>           last field id            (default 7296)
 *   --polls <n>         how many times to ask    (default 10)
 */

import https from 'node:https';
import http from 'node:http';

import { pickContract } from './lib/ibkr-normalize.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const options = {
    symbol: 'PLUG', conid: null, gateway: 'https://localhost:5000',
    from: 7280, to: 7296, polls: 10,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case '--symbol': options.symbol = next().toUpperCase(); break;
      case '--conid': options.conid = next(); break;
      case '--gateway': options.gateway = next().replace(/\/$/, ''); break;
      case '--from': options.from = Number(next()); break;
      case '--to': options.to = Number(next()); break;
      case '--polls': options.polls = Number(next()); break;
      case '--help': case '-h': options.help = true; break;
      default: break;
    }
  }
  return options;
}

function request(url, { timeout = 15000 } = {}) {
  const target = new URL(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(target.hostname);
  const transport = target.protocol === 'http:' ? http : https;

  return new Promise((resolvePromise, reject) => {
    const req = transport.request(
      target,
      {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'snake-eye/fields' },
        // Relaxed for the loopback gateway only: it ships a self-signed
        // certificate. Never relaxed for a remote host.
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
            }));
            return;
          }
          try {
            resolvePromise(body ? JSON.parse(body) : null);
          } catch {
            reject(new Error(`Non-JSON response: ${body.slice(0, 120)}`));
          }
        });
      },
    );
    req.setTimeout(timeout, () => req.destroy(new Error(`Timeout after ${timeout}ms`)));
    req.on('error', reject);
    req.end();
  });
}

async function resolveConid(gateway, symbol) {
  const rows = await request(
    `${gateway}/v1/api/iserver/secdef/search?symbol=${symbol}&name=false&secType=STK`,
    { timeout: 10000 },
  );
  const contract = pickContract(rows, symbol);
  if (!contract) throw new Error(`No US stock contract for ${symbol}`);
  return contract;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('node scripts/ibkr-fields.mjs --symbol PLUG [--conid n] [--from 7280] [--to 7296]');
    return;
  }

  // Print before touching the network. A contract lookup against a sleeping
  // gateway can sit for its full timeout, and a script that prints nothing for
  // fifteen seconds is indistinguishable from one that did not start.
  console.log(`\nSnake Eye — snapshot field probe`);
  console.log(`  gateway  : ${options.gateway}`);
  console.log(`  fields   : ${options.from}–${options.to}`);
  console.log(`  polls    : up to ${options.polls}, 1.2s apart`);

  let label = options.symbol;
  let conid = options.conid;
  if (!conid) {
    process.stdout.write(`  contract : resolving ${options.symbol} ... `);
    const contract = await resolveConid(options.gateway, options.symbol);
    conid = contract.conid;
    label = `${contract.ticker} — ${contract.name}`;
    console.log(`${label} (conid ${conid})`);
  } else {
    console.log(`  contract : conid ${conid}`);
  }
  console.log('');

  const ids = [];
  for (let id = options.from; id <= options.to; id += 1) ids.push(String(id));

  const url = `${options.gateway}/v1/api/iserver/marketdata/snapshot?conids=${conid}&fields=${ids.join(',')}`;

  const merged = {};
  const firstSeenAt = {};

  for (let poll = 1; poll <= options.polls; poll += 1) {
    let rows = null;
    try {
      rows = await request(url);
    } catch (error) {
      console.log(`  poll ${String(poll).padStart(2)} — ${error.message}`);
      await sleep(1200);
      continue;
    }

    const row = Array.isArray(rows) ? rows[0] : rows;
    const fresh = [];
    if (row && typeof row === 'object') {
      for (const [key, value] of Object.entries(row)) {
        if (!(key in merged)) { fresh.push(key); firstSeenAt[key] = poll; }
        merged[key] = value;
      }
    }
    console.log(`  poll ${String(poll).padStart(2)} — ${fresh.length ? `new: ${fresh.join(', ')}` : 'nothing new'}`);
    if (ids.every((id) => merged[id] !== undefined)) break;
    if (poll < options.polls) await sleep(1200);
  }

  console.log('\n  field   poll  value');
  console.log('  ─────   ────  ─────');
  for (const id of ids) {
    const value = merged[id];
    const raw = merged[`${id}_raw`];
    if (value === undefined) {
      console.log(`  ${id}      —   (never sent)`);
      continue;
    }
    const rawNote = raw === undefined ? '' : `   [${id}_raw: ${raw}]`;
    console.log(`  ${id}    ${String(firstSeenAt[id]).padStart(3)}   ${JSON.stringify(value)}${rawNote}`);
  }

  const extras = Object.keys(merged)
    .filter((key) => !ids.includes(key) && !key.endsWith('_raw'));
  if (extras.length) {
    console.log(`\n  also returned: ${extras.join(', ')}`);
  }

  console.log('\nSend this table back — it says which id carries market cap, P/E and EPS');
  console.log('on your gateway build, and whether they arrive at all.\n');
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  if (error.status === 403) {
    console.error('  403 means the gateway is running but not logged in — open https://localhost:5000');
  } else if (error.code === 'ECONNREFUSED') {
    console.error('  Nothing is listening there — start the gateway first, then npm run gateway');
  } else if (/Timeout/.test(error.message)) {
    console.error('  The gateway accepted the connection but never answered. An idle session');
    console.error('  goes to sleep: reload https://localhost:5000 and run npm run gateway.');
  }
  process.exitCode = 1;
});
