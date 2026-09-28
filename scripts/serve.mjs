#!/usr/bin/env node
/**
 * Snake Eye — the local server.
 *
 * Serves the site, and adds the one thing a static server cannot: an endpoint
 * that pulls a symbol from the gateway on request. The browser cannot call the
 * gateway itself — it answers on https with a self-signed certificate and
 * refuses anything carrying an Origin header — so the pull happens here, in the
 * same process that already knows how.
 *
 *   npm start                    http://localhost:8080
 *   npm start -- --port 3000
 *   npm start -- --no-api        static only, as a plain file server
 *
 * The API is deliberately small and read-only against IBKR: it resolves a
 * symbol, fetches its bars and fundamentals, and writes them into
 * data/stocks.local.json. There is no path here that can place an order,
 * because the gateway client this imports has no such function in it.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

import {
  mergeIntoFile,
  normalizeSymbol,
  pullSymbol,
  removeFromFile,
} from './lib/pull-symbol.mjs';
import { checkAuth, resolveGateway } from './lib/ibkr-client.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

function parseArgs(argv) {
  const options = { port: 8080, gateway: 'https://localhost:5000', api: true, host: '0.0.0.0' };
  for (let i = 0; i < argv.length; i += 1) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case '--port': case '-p': options.port = Number(next()); break;
      case '--gateway': options.gateway = next().replace(/\/$/, ''); break;
      case '--no-api': options.api = false; break;
      case '--host': options.host = next(); break;
      default: break;
    }
  }
  return options;
}

/* ------------------------------------------------------------------ static */

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    // The data changes under the browser's feet on every pull; a cached copy
    // would show yesterday's numbers with no way to tell.
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const json = (res, status, payload) =>
  send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8');

async function serveStatic(pathname, res) {
  // Resolve inside ROOT and verify it stayed there: `..` in a URL must not
  // reach the rest of the disk.
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(ROOT, relative);
  if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
    return send(res, 403, 'Forbidden');
  }

  try {
    let info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = join(filePath, 'index.html');
      info = await stat(filePath);
    }
    const body = await readFile(filePath);
    return send(res, 200, body, MIME[extname(filePath).toLowerCase()] || 'application/octet-stream');
  } catch {
    return send(res, 404, 'Not found');
  }
}

/* --------------------------------------------------------------------- api */

function readBody(req, limit = 4096) {
  return new Promise((resolvePromise, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) reject(new Error('Body too large'));
    });
    req.on('end', () => resolvePromise(body));
    req.on('error', reject);
  });
}

async function handleStatus(options, res) {
  try {
    const base = await resolveGateway(options.gateway);
    await checkAuth(base);
    return json(res, 200, { gateway: 'ready', url: base });
  } catch (error) {
    const state = error.status === 403 ? 'not-logged-in'
      : error.code === 'ECONNREFUSED' ? 'not-running'
        : 'unreachable';
    return json(res, 200, { gateway: state, message: error.message });
  }
}

async function handlePull(req, res, options) {
  let symbol;
  try {
    symbol = normalizeSymbol(JSON.parse(await readBody(req)).symbol);
  } catch {
    return json(res, 400, { error: 'Send {"symbol":"PLUG"}.' });
  }
  if (!symbol) {
    return json(res, 400, { error: 'That is not a ticker. Letters and dots, up to six.' });
  }

  const started = Date.now();
  try {
    const { contract, record, row, bars } = await pullSymbol(symbol, { gateway: options.gateway });
    const { total, replaced } = await mergeIntoFile(record);

    console.log(`  + ${symbol.padEnd(6)} ${contract.name} · ${bars} bars · score ${row.score.total}`
      + `  (${((Date.now() - started) / 1000).toFixed(1)}s)`);

    return json(res, 200, {
      ticker: row.ticker,
      name: row.name,
      exchange: row.exchange,
      conid: contract.conid,
      price: row.metrics.price,
      changePercent: row.metrics.changePercent,
      bars,
      lastSession: row.dates.at(-1),
      score: row.score.total,
      tone: row.score.tone,
      label: row.score.label,
      fundamentals: row.score.fundamentalsAvailable,
      replaced,
      total,
    });
  } catch (error) {
    console.log(`  ✗ ${symbol}: ${error.message}`);
    const status = error.status === 403 ? 503 : 502;
    return json(res, status, {
      error: error.message,
      code: error.code || null,
      hint: error.status === 403
        ? 'The gateway is running but not logged in — open https://localhost:5000.'
        : error.code === 'ECONNREFUSED'
          ? 'The gateway is not running. Start it, then reload.'
          : error.status === 500
            ? 'The contract resolved to something that is not a US cash equity — a ticker can collide with a futures or index contract.'
            : null,
    });
  }
}

async function handleRemove(pathname, res) {
  const symbol = normalizeSymbol(pathname.slice('/api/ticker/'.length));
  if (!symbol) return json(res, 400, { error: 'Not a ticker.' });
  const { total, removed } = await removeFromFile(symbol);
  return json(res, 200, { ticker: symbol, removed, total });
}

/* -------------------------------------------------------------------- main */

function localAddresses(port) {
  const out = [`http://localhost:${port}`];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(`http://${net.address}:${port}`);
    }
  }
  return out;
}

const options = parseArgs(process.argv.slice(2));

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname.startsWith('/api/')) {
    if (!options.api) return json(res, 404, { error: 'API disabled (--no-api).' });

    try {
      if (req.method === 'GET' && pathname === '/api/status') return await handleStatus(options, res);
      if (req.method === 'POST' && pathname === '/api/ticker') return await handlePull(req, res, options);
      if (req.method === 'DELETE' && pathname.startsWith('/api/ticker/')) return await handleRemove(pathname, res);
      return json(res, 404, { error: 'No such endpoint.' });
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  return serveStatic(pathname === '/' ? '/index.html' : pathname, res);
});

server.listen(options.port, options.host, () => {
  console.log('\n🐍 Snake Eye\n');
  for (const url of localAddresses(options.port)) console.log(`   ${url}`);
  console.log(options.api
    ? `\n   Pulling symbols through ${options.gateway}`
    : '\n   Static only — the ticker box will not appear.');
  console.log('   Ctrl+C to stop.\n');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n✗ Port ${options.port} is already in use.`);
    console.error('  Another Snake Eye is probably running — or use: npm start -- --port 8081\n');
  } else {
    console.error(`\n✗ ${error.message}\n`);
  }
  process.exitCode = 1;
});
