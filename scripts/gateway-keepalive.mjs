#!/usr/bin/env node
/**
 * Snake Eye — keep the IBKR session alive.
 *
 *   npm run keepalive
 *
 * The Client Portal Gateway drops its brokerage session after a few idle
 * minutes, which is why an ingest that worked in the morning fails at lunchtime
 * with nothing having changed. This pings `/tickle` on a timer so the session
 * stays up for as long as the window is open.
 *
 * It does not keep you logged in forever: the login itself expires roughly
 * daily and only a browser sign-in renews that. What this prevents is the
 * session going to sleep between scans.
 *
 * Options:
 *   --gateway <url>   default https://localhost:5000
 *   --every <sec>     ping interval, default 60
 *   --quiet           only print changes and problems, not every ping
 */

import https from 'node:https';
import http from 'node:http';

const argv = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const index = argv.indexOf(flag);
  return index === -1 ? fallback : argv[index + 1];
};

const gateway = argValue('--gateway', 'https://localhost:5000');
const everySeconds = Math.max(15, Number(argValue('--every', 60)));
const quiet = argv.includes('--quiet');

/** Same minimal headers the rest of the toolchain uses — curl-shaped. */
function apiHeaders() {
  return {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': 'snake-eye/0.2',
  };
}

function request(path, { method = 'GET' } = {}) {
  const url = new URL(path, gateway);
  const transport = url.protocol === 'http:' ? http : https;
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method,
        headers: apiHeaders(),
        // Self-signed certificate, localhost only.
        rejectUnauthorized: !(isLocal && url.protocol === 'https:'),
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            /* the gateway answers HTML when there is no session */
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.setTimeout(10000, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

const stamp = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

let lastState = null;
let failures = 0;

async function ping() {
  try {
    // /tickle both reports and refreshes; the status call is the fallback for
    // builds where tickle answers without the session block.
    const tickle = await request('/v1/api/tickle', { method: 'POST' });

    if (tickle.status === 403 || !tickle.json) {
      report('logged-out', `${stamp()}  ✗ no session — sign in at ${gateway}`);
      return;
    }

    const session = tickle.json.iserver?.authStatus;
    const authenticated = session?.authenticated ?? true;
    const competing = session?.competing ?? false;

    if (!authenticated) {
      report('logged-out', `${stamp()}  ✗ session expired — sign in again at ${gateway}`);
      return;
    }
    if (competing) {
      report('competing', `${stamp()}  ⚠ another session is competing (TWS, mobile app, second gateway)`);
      return;
    }

    failures = 0;
    report('alive', `${stamp()}  ✓ session alive`);
  } catch (error) {
    failures += 1;
    report('unreachable', `${stamp()}  ✗ gateway unreachable (${error.message})${failures > 2 ? ' — is its window still open?' : ''}`);
  }
}

/** In quiet mode only state changes and problems reach the console. */
function report(state, line) {
  const changed = state !== lastState;
  lastState = state;
  if (!quiet || changed || state !== 'alive') console.log(line);
}

console.log(`🐍 Keeping the IBKR session alive — ${gateway}, every ${everySeconds}s`);
console.log('   Leave this window open while you work. Ctrl+C to stop.\n');

await ping();
const timer = setInterval(ping, everySeconds * 1000);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(timer);
    console.log('\nStopped. The session will go idle on its own from here.');
    process.exit(0);
  });
}
