#!/usr/bin/env node
/**
 * Snake Eye — IBKR gateway status.
 *
 *   npm run gateway
 *
 * One command that answers "why is the ingest not working", without opening a
 * browser: is the Client Portal Gateway running, is it the gateway at all, is
 * the session authenticated, and is something else holding the port.
 *
 * Exits 0 when the gateway is ready to ingest from, 1 otherwise, so it can also
 * guard a scheduled run:
 *
 *   npm run gateway && npm run ingest
 */

import https from 'node:https';
import http from 'node:http';
import net from 'node:net';

const gateway = process.argv.includes('--gateway')
  ? process.argv[process.argv.indexOf('--gateway') + 1]
  : 'https://localhost:5000';

/** `--debug` prints the exact exchange, so a refusal can be diagnosed from evidence. */
const DEBUG = process.argv.includes('--debug');

const target = new URL(gateway);
const PORT = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
const HOST = target.hostname;

/** Is anything listening at all? Distinguishes "not started" from "not answering". */
function portIsOpen() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port: PORT });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(3000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

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

function fetchStatus(base = gateway) {
  const url = new URL('/v1/api/iserver/auth/status', base);
  const transport = url.protocol === 'http:' ? http : https;
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const headers = apiHeaders();

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: 'GET',
        headers,
        // Local gateway serves a self-signed certificate; never relaxed for a
        // remote host.
        rejectUnauthorized: !(isLocal && url.protocol === 'https:'),
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (DEBUG) {
            console.log(`\n--- ${url.href}`);
            console.log('    request headers :', JSON.stringify(headers));
            console.log(`    response        : HTTP ${res.statusCode}`);
            console.log('    response headers:', JSON.stringify(res.headers));
            console.log(`    body            : ${body.slice(0, 300)}\n`);
          }
          try {
            resolve({ status: res.statusCode, json: JSON.parse(body) });
          } catch {
            // Something is on the port, but it is not the gateway API.
            resolve({ status: res.statusCode, json: null, body: body.slice(0, 120) });
          }
        });
      },
    );
    req.setTimeout(8000, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

function report(lines, ok) {
  console.log(lines.join('\n'));
  process.exitCode = ok ? 0 : 1;
}

const open = await portIsOpen();
if (!open) {
  report([
    `✗ Nothing is listening on ${HOST}:${PORT}`,
    '',
    '  Start the gateway:',
    '    cd %USERPROFILE%\\ibkr\\clientportal.gw     (Windows)',
    '    bin\\run.bat root\\conf.yaml',
    '',
    '  Already running in another window? Then it is on a different port —',
    `  pass it explicitly:  npm run gateway -- --gateway https://localhost:5001`,
  ], false);
  process.exit();
}

/**
 * `localhost` resolves to ::1 before 127.0.0.1 on Windows, and the gateway's
 * default conf.yaml allows only the IPv4 loopback — so it answers a perfectly
 * valid request with 403. The browser is unaffected because it reaches the
 * gateway over IPv4. Retrying on 127.0.0.1 is what makes the difference.
 */
function ipv4Variant(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== 'localhost') return null;
  parsed.hostname = '127.0.0.1';
  return parsed.toString().replace(/\/$/, '');
}

let result;
let effectiveGateway = gateway;
try {
  result = await fetchStatus();

  if ((result.status === 403 || !result.json) && ipv4Variant(gateway)) {
    const ipv4 = ipv4Variant(gateway);
    const retry = await fetchStatus(ipv4);
    if (retry.json) {
      console.log(`ℹ localhost was refused (HTTP ${result.status}); reached the gateway on ${ipv4} instead.`);
      console.log('  Use that address from now on:  npm run ingest -- --gateway ' + ipv4);
      console.log('');
      result = retry;
      effectiveGateway = ipv4;
    }
  }
} catch (error) {
  report([
    `✗ ${HOST}:${PORT} accepts connections but the API did not answer (${error.message})`,
    '',
    '  Usually a second gateway that failed to start ("Address already in use"),',
    '  or another program on the port. Close every gateway window, then:',
    '    taskkill /IM java.exe /F        (Windows)',
    '  and start exactly one gateway.',
  ], false);
  process.exit();
}

if (!result.json) {
  const lines = [
    `✗ ${HOST}:${PORT} answered, but not with the gateway API`,
    `  (HTTP ${result.status}, replied: ${result.body || 'no body'})`,
    '',
  ];

  if (result.status === 403) {
    lines.length = 0;
    lines.push(
      '✗ Gateway is running, but there is no logged-in session yet',
      '',
      `  It answers 403 until you log in through the browser: open ${gateway},`,
      '  accept the self-signed certificate and sign in. The API works from that',
      '  moment on — this is the gateway\'s way of saying "not authenticated".',
      '',
      '  Already logged in and still 403? Run with --debug and compare against:',
      `    curl -k ${gateway}/v1/api/iserver/auth/status`,
    );
  } else {
    lines.push(
      '  On macOS this is usually AirPlay Receiver squatting on port 5000.',
      '  Move the gateway to another port in root/conf.yaml and re-run with',
      '  --gateway https://localhost:5001',
    );
  }

  report(lines, false);
  process.exit();
}

const { authenticated, connected, competing } = result.json;

if (!authenticated) {
  report([
    '✗ Gateway is running but the session is not authenticated',
    '',
    `  Log in at ${gateway} — in a private window if a previous attempt failed,`,
    '  because stale cookies cause a repeating "Action failed".',
    '  The login expires roughly daily and the session sleeps after a few idle minutes.',
  ], false);
  process.exit();
}

const notes = [];
if (competing) {
  notes.push('  ⚠ another session (TWS, the mobile app, a second gateway) is competing —');
  notes.push('    data can be interrupted mid-run; log out of that one.');
}
if (connected === false) {
  notes.push('  ⚠ authenticated but not connected to the brokerage backend yet; retry in a moment.');
}

report([
  `✓ Gateway ready at ${effectiveGateway}`,
  `  authenticated: ${authenticated}   connected: ${connected}   competing: ${Boolean(competing)}`,
  ...notes,
  '',
  effectiveGateway === gateway
    ? '  Next:  npm run ingest -- --limit 10'
    : `  Next:  npm run ingest -- --gateway ${effectiveGateway}`,
], authenticated && connected !== false);
