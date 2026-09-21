/**
 * Snake Eye — Interactive Brokers Client Portal Gateway client.
 *
 * Everything that talks to the gateway on localhost lives here, so the bulk
 * ingest and the single-symbol lookup share one implementation: one place where
 * pacing, retries, the IPv6 fallback and the snapshot polling are decided, and
 * no chance of the two drifting into answering the same question differently.
 *
 * Nothing here reads argv or writes files — callers own that.
 */

import https from 'node:https';
import http from 'node:http';

import {
  SNAPSHOT_FIELDS,
  SNAPSHOT_FUNDAMENTAL_FIELDS,
  normalizeFundamentals,
  normalizeSnapshot,
  pickContract,
} from './ibkr-normalize.mjs';

/**
 * Headers the gateway is verified to accept — deliberately close to what curl
 * sends, since curl demonstrably works against it.
 *
 * No Origin and no Referer: supplying them makes the gateway treat the call as
 * cross-origin and refuse it, and they buy nothing for a local client.
 */
export function apiHeaders() {
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
export function request(url, { timeout = 30000, method = 'GET', body = null } = {}) {
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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * IBKR documents a pacing limit of roughly 60 historical-data requests per
 * 10 minutes. Exceeding it gets the session throttled, so the limiter waits
 * rather than letting the run trip it.
 */
export function createPacer({ delay, windowMs = 10 * 60 * 1000, maxInWindow = 60 }) {
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
export async function withRetry(label, fn, attempts = 3) {
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
export async function resolveGateway(gateway) {
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

export async function checkAuth(gateway) {
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
export async function initSession(gateway) {
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
export async function resolveContract(gateway, symbol, { debug = false } = {}) {
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

export async function fetchHistory(gateway, conid, { period, bar }) {
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
export async function lookupExchange(gateway, symbol) {
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
 * Market cap, P/E and EPS ride along with the market data snapshot, which every
 * account can request — no Refinitiv entitlement involved.
 *
 * The snapshot endpoint needs asking twice: the first call only opens the
 * subscription and comes back with the field list unpopulated, the second
 * carries the values.
 */
/**
 * The snapshot endpoint does not answer a question, it subscribes to a feed.
 * The first call opens the subscription and returns the row with no fields on
 * it; later calls return whatever has arrived so far, and the slower fields
 * (market cap, P/E, EPS) can take several seconds longer than industry and
 * average volume. Two calls therefore look like "only industry is available" —
 * which is exactly how this read as "no entitlement". Poll until the requested
 * fields stop arriving, and merge across attempts, since a field present in one
 * response may be absent from the next.
 */
const SNAPSHOT_ATTEMPTS = 8;
const SNAPSHOT_GAP_MS = 1200;

export async function fetchSnapshot(gateway, conid) {
  const ids = Object.keys(SNAPSHOT_FIELDS);
  const url = `${gateway}/v1/api/iserver/marketdata/snapshot?conids=${conid}&fields=${ids.join(',')}`;
  const merged = {};
  let attempts = 0;

  for (let i = 0; i < SNAPSHOT_ATTEMPTS; i += 1) {
    attempts = i + 1;
    let rows = null;
    try {
      rows = await request(url, { timeout: 15000 });
    } catch {
      /* a refused poll is not fatal — the next one may still answer */
    }

    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row && typeof row === 'object') Object.assign(merged, row);
    if (ids.every((id) => merged[id] !== undefined)) break;
    if (i < SNAPSHOT_ATTEMPTS - 1) await sleep(SNAPSHOT_GAP_MS);
  }

  const missing = ids.filter((id) => merged[id] === undefined);
  return { data: normalizeSnapshot(merged), raw: merged, attempts, missing };
}

/**
 * The deeper figures — revenue, margins, ROE, debt/equity — come from the
 * Refinitiv fundamentals, which IBKR exposes on a path that has moved between
 * gateway versions. Each candidate is tried in turn and failure is not fatal.
 */
export async function fetchRefinitiv(gateway, conid) {
  const paths = [
    `/v1/api/iserver/fundamentals/${conid}/summary`,
    `/v1/api/fundamentals/landing/${conid}`,
    `/v1/api/fundamentals/summary/${conid}`,
    `/v1/api/iserver/fundamentals/${conid}/financials`,
  ];

  for (const path of paths) {
    try {
      const payload = await request(`${gateway}${path}`, { timeout: 20000 });
      if (!payload || typeof payload !== 'object') continue;

      const source = payload.ratios || payload.summary || payload;
      const mapped = normalizeFundamentals(source);
      if (Object.values(mapped).some((value) => value !== null)) {
        return { data: mapped, raw: payload, path };
      }
    } catch {
      /* try the next path */
    }
  }
  return { data: {}, raw: null, path: null };
}

/**
 * Everything the account can tell us about a company's fundamentals.
 *
 * Refinitiv supplies the richer set and wins where both answer; the snapshot
 * fills what is left, which on an account without that entitlement is still
 * market cap, P/E and EPS.
 */
/**
 * Tallied across the whole run so the summary can tell "asked wrongly" from
 * "not entitled". One symbol proves nothing — a company can genuinely lack a
 * P/E. Every symbol in the universe missing the same three fields, across ten
 * polls each, is the entitlement.
 */
export const feedReport = { snapshotFundamentals: false, refinitivAnswered: false };

export async function fetchFundamentals(gateway, conid, { debug = false } = {}) {
  const [refinitiv, snapshot] = [await fetchRefinitiv(gateway, conid), await fetchSnapshot(gateway, conid)];

  if (refinitiv.path) feedReport.refinitivAnswered = true;
  if (SNAPSHOT_FUNDAMENTAL_FIELDS.some((id) => snapshot.raw?.[id] !== undefined)) {
    feedReport.snapshotFundamentals = true;
  }

  const merged = { ...snapshot.data };
  for (const [key, value] of Object.entries(refinitiv.data)) {
    if (value !== null && value !== undefined) merged[key] = value;
  }

  if (debug) {
    console.log(`      fundamentals for ${conid}:`);
    console.log(`        refinitiv path : ${refinitiv.path || 'none answered'}`);
    console.log(`        refinitiv raw  : ${JSON.stringify(refinitiv.raw).slice(0, 400)}`);
    console.log(`        snapshot polls : ${snapshot.attempts}, fields never sent: ` +
      `${snapshot.missing.length ? snapshot.missing.join(', ') : 'none'}`);
    console.log(`        snapshot raw   : ${JSON.stringify(snapshot.raw).slice(0, 400)}`);
    console.log(`        merged         : ${JSON.stringify(merged)}`);
  }

  return merged;
}

/* -------------------------------------------------------------------- run */

/* ----------------------------------------------------------------- account */

/** The accounts this gateway session can see. */
export async function fetchAccounts(gateway) {
  const rows = await request(`${gateway}/v1/api/portfolio/accounts`, { timeout: 15000 });
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({ id: row.accountId || row.id, title: row.accountTitle || row.displayName || '' }))
    .filter((account) => account.id);
}

/**
 * Stock positions currently held, as plain tickers.
 *
 * Options, futures and cash lines are dropped: the scanner scores equities, and
 * a list seeded from a portfolio should not arrive carrying instruments the
 * rest of the pipeline cannot price.
 */
export async function fetchPositions(gateway, accountId) {
  const symbols = new Map();

  // The endpoint pages; anything beyond a few hundred positions is not a
  // personal account, so a handful of pages is plenty.
  for (let page = 0; page < 5; page += 1) {
    let rows;
    try {
      rows = await request(`${gateway}/v1/api/portfolio/${accountId}/positions/${page}`, { timeout: 20000 });
    } catch {
      break;
    }
    if (!Array.isArray(rows) || !rows.length) break;

    for (const row of rows) {
      const assetClass = String(row.assetClass || row.secType || '').toUpperCase();
      if (assetClass && assetClass !== 'STK') continue;
      if (Number(row.position) === 0) continue;

      const ticker = String(row.ticker || row.contractDesc || '').trim().toUpperCase().split(' ')[0];
      if (/^[A-Z][A-Z.]{0,5}$/.test(ticker)) {
        symbols.set(ticker, { ticker, position: Number(row.position) || 0, conid: row.conid });
      }
    }
    if (rows.length < 30) break;
  }

  return [...symbols.values()];
}
