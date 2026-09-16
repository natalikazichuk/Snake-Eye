/**
 * Snake Eye — shared application shell.
 *
 * Formatting helpers used across every page, the common chrome (active nav
 * link, watchlist badge, footer year), and the behaviour of the quick scan
 * form on the landing page.
 */

import { loadUniverse, loadPresets } from './api.js';
import { criteriaToQuery, normalizeCriteria } from './filters.js';
import { count as watchlistCount, subscribe as onWatchlistChange } from './watchlist.js';

/* ------------------------------------------------------------------ format */

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

export const DASH = '—';

/** $8.42 — sub-dollar prices keep a third decimal so they stay readable. */
export function formatPrice(value) {
  if (!isNum(value)) return DASH;
  return `$${value.toFixed(value < 1 ? 3 : 2)}`;
}

/** 2.1M, 940K, 12.4B. */
export function formatCompact(value, digits = 1) {
  if (!isNum(value)) return DASH;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(digits)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${sign}${Math.round(abs / 1e3)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

/** $740M. */
export function formatMoney(value) {
  return isNum(value) ? `$${formatCompact(value)}` : DASH;
}

/** 18.0% from a ratio (0.18). */
export function formatRatioPercent(value, digits = 1) {
  return isNum(value) ? `${(value * 100).toFixed(digits)}%` : DASH;
}

/** +7.31% from an already-percentage number, sign always shown. */
export function formatSignedPercent(value, digits = 2) {
  if (!isNum(value)) return DASH;
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

/** Plain number with fixed decimals. */
export function formatNumber(value, digits = 2) {
  return isNum(value) ? value.toFixed(digits) : DASH;
}

/** 2.33x. */
export function formatMultiple(value, digits = 2) {
  return isNum(value) ? `${value.toFixed(digits)}x` : DASH;
}

/** 'up' / 'down' / 'flat' — drives the green/red/grey text classes. */
export function direction(value, threshold = 0) {
  if (!isNum(value)) return 'flat';
  if (value > threshold) return 'up';
  if (value < threshold) return 'down';
  return 'flat';
}

/* --------------------------------------------------------------- dom utils */

export const qs = (selector, scope = document) => scope.querySelector(selector);
export const qsa = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/** Minimal element builder: el('span', { className: 'x', text: 'hi' }). */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'className') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Signal pill: 🟢 / 🔴 / ⚪ with an accessible label. */
export function signalDot(state, label) {
  const tone = state === true ? 'up' : state === false ? 'down' : 'flat';
  const glyph = tone === 'up' ? '🟢' : tone === 'down' ? '🔴' : '⚪';
  return el('span', { className: `signal signal--${tone}`, title: label, 'aria-label': label }, [glyph]);
}

/** Link to a stock page that works from the root and from pages/ alike. */
export function stockHref(ticker) {
  const prefix = document.body.dataset.page === 'home' ? 'pages/' : '';
  return `${prefix}stock.html?ticker=${encodeURIComponent(ticker)}`;
}

export function scannerHref(criteria) {
  const prefix = document.body.dataset.page === 'home' ? 'pages/' : '';
  const query = criteria ? `?${criteriaToQuery(normalizeCriteria(criteria))}` : '';
  return `${prefix}scanner.html${query}`;
}

/** Render an error banner into a container (data loading is the usual cause). */
export function renderError(container, error) {
  container.replaceChildren(
    el('div', { className: 'notice notice--error' }, [
      el('strong', { text: 'Could not load market data. ' }),
      el('span', { text: error.message || String(error) }),
      el('p', {
        className: 'notice__hint',
        text: 'Snake Eye reads data/stocks.json over fetch, which needs a web server — open the project through a local server or GitHub Pages rather than from the file system.',
      }),
    ]),
  );
}

/**
 * Tell every page what it is looking at.
 *
 * The pages ship with the demo-data disclaimer in their markup; once a real
 * IBKR snapshot is loaded, saying "demo data" would be simply untrue, so both
 * the stamp and the disclaimer are rewritten here.
 */
export function renderSourceInfo(meta = {}, symbolCount = 0) {
  const live = meta.provider === 'IBKR';

  const stamp = [
    `${symbolCount} symbols`,
    meta.lastSession ? `session ${meta.lastSession}` : null,
    live ? 'Interactive Brokers · end of day' : 'demo data',
  ]
    .filter(Boolean)
    .join(' · ');

  qsa('[data-source-stamp]').forEach((node) => {
    node.textContent = stamp;
  });

  if (!live) return;

  qsa('[data-disclaimer]').forEach((node) => {
    node.replaceChildren(
      el('strong', { text: 'Your IBKR data. ' }),
      el('span', {
        text:
          `End-of-day bars from your own Interactive Brokers subscription (last session ${meta.lastSession || DASH}), ` +
          'for personal use — not redistributed and not live intraday. ' +
          (meta.hasFundamentals
            ? ''
            : 'Fundamentals were not supplied, so the Snake Score is weighted across the technical, momentum and volume components only. ') +
          'The Snake Score measures fit to the selected criteria — it is not a forecast and not investment advice.',
      }),
    );
  });
}

/* -------------------------------------------------------------- page shell */

function markActiveNav() {
  const page = document.body.dataset.page;
  qsa('[data-nav]').forEach((link) => {
    const active = link.dataset.nav === page;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
  });
}

function refreshWatchlistBadge() {
  const total = watchlistCount();
  qsa('[data-watchlist-badge]').forEach((badge) => {
    badge.textContent = String(total);
    badge.hidden = total === 0;
  });
}

function initShell() {
  markActiveNav();
  refreshWatchlistBadge();
  onWatchlistChange(refreshWatchlistBadge);
  qsa('[data-current-year]').forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
}

/* ---------------------------------------------------------------- homepage */

/** The landing page form is a subset of the scanner's — hand it off with a query. */
function initQuickScan() {
  const form = qs('#quick-scan');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const raw = Object.fromEntries(data.entries());
    raw.exchanges = data.getAll('exchanges');
    window.location.href = scannerHref(raw);
  });
}

/** Landing page: today's strongest setups, straight from the scored universe. */
async function initHomeHighlights() {
  const container = qs('#home-highlights');
  if (!container) return;

  try {
    const [{ rows, meta }, presets] = await Promise.all([loadUniverse(), loadPresets()]);

    const top = rows.slice(0, 5);
    container.replaceChildren(
      ...top.map((row) =>
        el('a', { className: 'highlight', href: stockHref(row.ticker) }, [
          el('span', { className: 'highlight__ticker', text: row.ticker }),
          el('span', { className: 'highlight__price', text: formatPrice(row.metrics.price) }),
          el('span', {
            className: `highlight__change is-${direction(row.metrics.changePercent)}`,
            text: formatSignedPercent(row.metrics.changePercent),
          }),
          el('span', { className: 'highlight__score', text: String(row.score.total) }),
        ]),
      ),
    );

    renderSourceInfo(meta, rows.length);

    const presetList = qs('#home-presets');
    if (presetList) {
      presetList.replaceChildren(
        ...presets.map((preset) =>
          el('a', { className: 'preset-chip', href: `${scannerHref()}?preset=${preset.id}` }, [
            el('span', { className: 'preset-chip__emoji', text: preset.emoji }),
            el('span', { text: preset.name }),
          ]),
        ),
      );
    }
  } catch (error) {
    renderError(container, error);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initShell();
  initQuickScan();
  initHomeHighlights();
});
