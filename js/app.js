/**
 * Snake Eye — shared application shell.
 *
 * Formatting helpers used across every page, the common chrome (active nav
 * link, watchlist badge, footer year), and the behaviour of the quick scan
 * form on the landing page.
 */

import { loadUniverse, loadPresets } from './api.js';
import { applyFilters, countActiveFilters, criteriaToQuery, explainNoMatches, normalizeCriteria } from './filters.js';
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
/**
 * How stale the data is, in words.
 *
 * A date alone makes the reader do the arithmetic, and on a phone glanced at
 * over breakfast that is exactly the arithmetic they will skip. Weekends are
 * not counted out: "3 days ago" over a weekend still means the last session
 * was Friday, which is the right thing to know.
 */
function describeAge(lastSession) {
  if (!lastSession) return null;

  const then = new Date(`${lastSession}T00:00:00Z`);
  if (Number.isNaN(then.getTime())) return null;

  const today = new Date();
  const days = Math.floor(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - then.getTime())
    / 86400000,
  );

  if (days < 0) return null;
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'over a week old';
  return `${Math.floor(days / 7)} weeks old`;
}

export function renderSourceInfo(meta = {}, symbolCount = 0) {
  const live = meta.provider === 'IBKR';
  const age = describeAge(meta.lastSession);

  const stamp = [
    `${symbolCount} symbols`,
    meta.lastSession ? `session ${meta.lastSession}` : null,
    age,
    live ? 'Interactive Brokers · end of day' : 'demo data',
  ]
    .filter(Boolean)
    .join(' · ');

  qsa('[data-source-stamp]').forEach((node) => {
    node.textContent = stamp;
    node.classList.toggle('is-stale', live && /week/.test(age || ''));
  });

  markDemo(!live);

  qsa('[data-disclaimer]').forEach((node) => {
    node.replaceChildren(
      el('strong', { text: live ? 'Your IBKR data. ' : 'Demo data. ' }),
      el('span', {
        text: live
          ? `End-of-day bars from your own Interactive Brokers subscription (last session ${meta.lastSession || DASH}), ` +
            'for personal use — not redistributed and not live intraday. ' +
            (meta.hasFundamentals
              ? ''
              : 'Fundamentals were not supplied, so the Snake Score is weighted across the technical, momentum and volume components only. ') +
            'The Snake Score measures fit to the selected criteria — it is not a forecast and not investment advice.'
          : 'Every company, price and indicator on this page is generated. The symbols are invented, but a few of them ' +
            'coincide with real listed tickers by accident — a symbol here is NOT the real company that trades under it. ' +
            'Run the Interactive Brokers ingest (docs/IBKR.md) to scan real prices.',
      }),
    );
  });
}

/**
 * Demo mode has to be impossible to miss.
 *
 * Invented four-letter tickers collide with real listings (WNDR, MORF, VRDN,
 * XYZ and others all exist somewhere), so a quiet footnote is not enough: a
 * generated "WNDR" priced at $3.88 can be mistaken for the real company of the
 * same symbol. The badge rides in the header of every page, and the stock page
 * repeats it next to the exchange tag.
 */
function markDemo(isDemo) {
  qsa('.brand').forEach((brand) => {
    const existing = brand.querySelector('.demo-badge');
    if (!isDemo) {
      existing?.remove();
      return;
    }
    if (existing) return;
    brand.append(
      el('span', {
        className: 'demo-badge',
        title: 'Generated sample data — not a real market feed',
        text: 'DEMO',
      }),
    );
  });

  const heroLine = qs('#stock-ticker')?.parentElement;
  if (!heroLine) return;
  const existing = heroLine.querySelector('.demo-badge');
  if (!isDemo) {
    existing?.remove();
  } else if (!existing) {
    heroLine.append(
      el('span', {
        className: 'demo-badge demo-badge--lg',
        title: 'Generated sample data — this is not the real company trading under this symbol',
        text: 'DEMO — not a real company',
      }),
    );
  }
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

/** The landing page form is a subset of the scanner's, read the same way. */
function readQuickScan(form) {
  const data = new FormData(form);
  const raw = Object.fromEntries(data.entries());
  raw.exchanges = data.getAll('exchanges');
  return normalizeCriteria(raw);
}

/** How many rows the landing page shows before pointing at the full scanner. */
const HOME_ROWS = 15;

/**
 * The landing page runs the scan itself rather than sending the form to
 * another page: the point of a scanner is the list of matches, and making
 * someone submit a form and wait for a navigation to see one is a worse
 * version of the same thing. The full scanner keeps the columns, sorting,
 * presets and URL sharing this deliberately leaves out.
 */
function initQuickScan(rows) {
  const form = qs('#quick-scan');
  const body = qs('#home-results-body');
  if (!form || !body) return;

  const countLabel = qs('#home-results-count');
  const emptyNote = qs('#home-results-empty');
  const moreLink = qs('#home-results-more');

  function run() {
    const criteria = readQuickScan(form);
    const matches = applyFilters(rows, criteria);
    const shown = matches.slice(0, HOME_ROWS);

    body.replaceChildren(...shown.map((row) => el('tr', {}, [
      el('td', {}, [el('a', { className: 'home-results__ticker', href: stockHref(row.ticker), text: row.ticker })]),
      el('td', { className: 'home-results__name', text: row.name }),
      el('td', { className: 'num', text: formatPrice(row.metrics.price) }),
      el('td', {
        className: `num is-${direction(row.metrics.changePercent)}`,
        text: formatSignedPercent(row.metrics.changePercent),
      }),
      el('td', { className: 'num home-results__vol', text: formatCompact(row.metrics.volume) }),
      el('td', {}, [el('span', {
        className: `score-pill tone-${row.score.tone}`,
        text: String(row.score.total),
      })]),
    ])));

    const active = countActiveFilters(criteria);
    const filterCount = qs('#scan-filters-count');
    if (filterCount) {
      filterCount.textContent = active === 0 ? 'none active' : `${active} active`;
    }
    countLabel.textContent = matches.length === rows.length
      ? `all ${rows.length} symbols`
      : `${matches.length} of ${rows.length} · ${active} filter${active === 1 ? '' : 's'}`;

    emptyNote.hidden = matches.length > 0;
    if (!matches.length) {
      const reasons = explainNoMatches(rows, criteria);
      emptyNote.textContent = reasons.length
        ? `Nothing matched. The narrowest filter is ${reasons[0].label} — it alone rejects ${reasons[0].rejected} of ${rows.length}.`
        : 'Nothing matched.';
    }

    moreLink.hidden = matches.length <= HOME_ROWS;
    moreLink.textContent = `See all ${matches.length} in the full scanner →`;
    moreLink.href = scannerHref(criteria);
  }

  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('input', run);
  form.addEventListener('change', run);
  qs('#quick-scan-reset')?.addEventListener('click', () => {
    form.reset();
    run();
  });

  /*
   * On a phone the filter form is a screenful in front of the answer, so it
   * collapses; on a wide screen there is room for both and hiding it would only
   * add a click. `details` cannot be held open by CSS, so the viewport decides
   * here — but only until the reader opens or closes it themselves, after which
   * their choice stands.
   */
  const filters = qs('#scan-filters');
  if (filters) {
    const wide = window.matchMedia('(min-width: 761px)');
    let touched = false;
    filters.addEventListener('toggle', () => { touched = true; });
    const sync = () => { if (!touched) filters.open = wide.matches; };
    wide.addEventListener('change', sync);
    sync();
  }

  run();
}

/** Landing page: load the universe once, then wire the scan and the presets. */
async function initHome() {
  const container = qs('#home-results');
  if (!container) return;

  try {
    const [{ rows, meta }, presets] = await Promise.all([loadUniverse(), loadPresets()]);

    renderSourceInfo(meta, rows.length);
    initQuickScan(rows);

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
  initHome();
});
