/**
 * Snake Eye — my tickers.
 *
 * Every symbol the last ingest pulled, with no filters over it. The scanner
 * answers "which of these fit this setup"; this page answers the question
 * underneath it — what is actually in the file, how fresh it is, and whether
 * anything in config/universe.json failed to come back.
 *
 * That last part matters because a symbol that fails to resolve is skipped
 * with one line in a terminal that has since scrolled away, and the scanner
 * cannot distinguish "filtered out" from "never pulled".
 */

import { loadUniverse } from './api.js';
import { hasFundamentals } from './score.js';
import { sortBy } from './sort.js';
import {
  DASH,
  direction,
  el,
  formatCompact,
  formatMultiple,
  formatNumber,
  formatPrice,
  formatSignedPercent,
  qs,
  renderError,
  renderSourceInfo,
  stockHref,
} from './app.js';

/** The personal scan list, alongside what actually came back for it. */
const UNIVERSE_CONFIG_URL = new URL('../config/universe.json', import.meta.url);

/*
 * Resolved against this module rather than the page. A relative 'api/status'
 * reads as /pages/api/status from pages/universe.html, which is nothing: the
 * form then stayed hidden on the one page it belongs to.
 */
const API_STATUS_URL = new URL('../api/status', import.meta.url);
const API_TICKER_URL = new URL('../api/ticker', import.meta.url);

/**
 * Sortable columns: click a header to sort by it, click again to flip. Text
 * columns start A→Z, numbers start highest first — the useful end of each.
 */
const SORTS = {
  ticker: { label: 'ticker', value: (row) => row.ticker, first: 'asc' },
  exchange: { label: 'exchange', value: (row) => row.exchange, first: 'asc' },
  price: { label: 'price', value: (row) => row.metrics.price },
  change: { label: 'change', value: (row) => row.metrics.changePercent },
  volume: { label: 'volume', value: (row) => row.metrics.volume },
  rvol: { label: 'relative volume', value: (row) => row.metrics.relativeVolume },
  rsi: { label: 'RSI', value: (row) => row.metrics.rsi14 },
  bars: { label: 'bars', value: (row) => row.dates?.length ?? null },
  fund: { label: 'fundamentals', value: (row) => (hasFundamentals(row.fundamentals) ? 1 : 0) },
  score: { label: 'score', value: (row) => row.score.total },
};

const SORT_STORAGE_KEY = 'snake-eye:universe-sort';
const DEFAULT_SORT = { key: 'score', dir: 'desc' };

/** The last sort this browser used; any storage failure just means the default. */
function loadSort() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SORT_STORAGE_KEY));
    if (saved && SORTS[saved.key] && (saved.dir === 'asc' || saved.dir === 'desc')) return saved;
  } catch {
    // private window, blocked storage, malformed value
  }
  return { ...DEFAULT_SORT };
}

function saveSort(sort) {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch {
    // not worth surfacing: the sort still works for this visit
  }
}

function describeSort(sort, count) {
  if (sort.key === 'score' && sort.dir === 'desc') return `${count} symbols, highest score first`;
  const { label } = SORTS[sort.key];
  const text = SORTS[sort.key].first === 'asc';
  const order = sort.dir === 'asc' ? (text ? 'A → Z' : 'lowest first') : (text ? 'Z → A' : 'highest first');
  return `${count} symbols, by ${label}, ${order}`;
}

function paintSortHeaders(sort) {
  for (const th of document.querySelectorAll('.universe-table th[data-sort]')) {
    const active = th.dataset.sort === sort.key;
    th.classList.toggle('is-sorted', active);
    th.classList.toggle('is-sorted--asc', active && sort.dir === 'asc');
    th.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  }
}

function scorePill(row) {
  return el('span', {
    className: `score-pill tone-${row.score.tone}`,
    text: String(row.score.total),
  });
}

function renderRows(rows) {
  return rows.map((row) => el('tr', {}, [
    el('td', {}, [
      el('a', { className: 'universe-table__link', href: stockHref(row.ticker) }, [
        el('strong', { text: row.ticker }),
        el('span', { className: 'universe-table__name', text: row.name }),
      ]),
    ]),
    el('td', { className: 'col-exchange' }, [el('span', { className: 'tag', text: row.exchange })]),
    el('td', { className: 'num', text: formatPrice(row.metrics.price) }),
    el('td', {
      className: `num is-${direction(row.metrics.changePercent)}`,
      text: formatSignedPercent(row.metrics.changePercent),
    }),
    el('td', { className: 'num col-volume', text: formatCompact(row.metrics.volume) }),
    el('td', { className: 'num col-rvol', text: formatMultiple(row.metrics.relativeVolume) }),
    el('td', { className: 'num col-rsi', text: formatNumber(row.metrics.rsi14, 0) }),
    el('td', { className: 'num col-bars', text: String(row.dates?.length ?? 0) }),
    el('td', { className: 'center col-fund' }, [
      hasFundamentals(row.fundamentals)
        ? el('span', { className: 'fund-mark fund-mark--yes', title: 'Fundamentals available', text: '●' })
        : el('span', {
            className: 'fund-mark fund-mark--no',
            title: 'No fundamentals — scored on three components',
            text: '○',
          }),
    ]),
    el('td', { className: 'num' }, [scorePill(row)]),
  ]));
}

/** Four numbers worth knowing before reading the table. */
function renderSummary(rows, meta) {
  const container = qs('#universe-summary');
  if (!container) return;

  const gainers = rows.filter((row) => row.metrics.changePercent > 0).length;
  const withFundamentals = meta.fundamentalsCount || 0;
  const best = rows[0];

  const card = (label, value, note) => el('div', { className: 'universe-stat' }, [
    el('span', { className: 'universe-stat__label', text: label }),
    el('span', { className: 'universe-stat__value', text: value }),
    note ? el('span', { className: 'universe-stat__note', text: note }) : null,
  ]);

  // Naming the gap beats counting it: whether a paid fundamentals feed is worth
  // buying depends on which symbols it would cover, not on how many.
  const without = rows.filter((row) => !hasFundamentals(row.fundamentals)).map((row) => row.ticker);
  const fundamentalsNote = withFundamentals === 0
    ? 'npm run fundamentals'
    : without.length === 0
      ? 'all covered'
      : without.length <= 6
        ? `missing: ${without.join(' ')}`
        : `${without.length} without`;

  container.replaceChildren(
    card('Symbols', String(rows.length), meta.lastSession ? `to ${meta.lastSession}` : ''),
    card('Up on the session', `${gainers} / ${rows.length}`, ''),
    card('Best score', best ? String(best.score.total) : DASH, best ? best.ticker : ''),
    card('With fundamentals', `${withFundamentals} / ${rows.length}`, fundamentalsNote),
  );
}

/**
 * Symbols listed in config/universe.json that the data file does not contain.
 *
 * Silence here is the point: a skipped symbol otherwise looks exactly like one
 * that was pulled and then filtered away.
 */
async function renderMissing(rows) {
  const section = qs('#universe-missing');
  const body = qs('#universe-missing-body');
  if (!section || !body) return;

  let configured = [];
  try {
    const response = await fetch(UNIVERSE_CONFIG_URL);
    if (!response.ok) return;
    const config = await response.json();
    configured = Array.isArray(config.symbols) ? config.symbols : [];
  } catch {
    // No config served (a bare deploy of the site) — nothing to compare against.
    return;
  }

  const pulled = new Set(rows.map((row) => row.ticker));
  const missing = configured.filter((symbol) => !pulled.has(String(symbol).toUpperCase()));
  if (!missing.length) return;

  section.hidden = false;
  body.replaceChildren(
    el('p', {
      className: 'universe-missing__lead',
      text: `${missing.length} of ${configured.length} symbols in config/universe.json are not in the data file. `
        + 'Either the last ingest skipped them, or it ran with --limit.',
    }),
    el('ul', { className: 'universe-missing__list' }, missing.map((symbol) =>
      el('li', {}, [el('code', { text: symbol })]))),
    el('p', {
      className: 'universe-missing__hint',
      text: 'npm run ticker -- SYMBOL pulls one of them without re-running the whole list.',
    }),
  );
}

/* ------------------------------------------------------------ pull a symbol */

/**
 * The box only appears when something can answer it.
 *
 * The page is also served statically from GitHub Pages, where there is no
 * server to pull anything; offering a control that cannot work is worse than
 * offering none. So the form stays hidden until /api/status replies, and says
 * what is wrong when the gateway is reachable but not ready.
 */
async function initTickerBox(reload) {
  const form = qs('#ticker-add');
  const input = qs('#ticker-add-input');
  const button = qs('#ticker-add-button');
  const status = qs('#ticker-add-status');
  if (!form || !input) return;

  let state;
  try {
    const response = await fetch(API_STATUS_URL);
    if (!response.ok) return;
    state = await response.json();
  } catch {
    return; // no local server — leave the form hidden
  }

  form.hidden = false;

  const setStatus = (text, tone = '') => {
    status.textContent = text;
    status.className = `ticker-add__status ${tone}`;
  };

  if (state.gateway !== 'ready') {
    setStatus(state.gateway === 'not-logged-in'
      ? 'Gateway running but not logged in — open https://localhost:5000'
      : 'Gateway not running — start it, then reload', 'is-warn');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const symbol = input.value.trim().toUpperCase();
    if (!symbol) return;

    input.disabled = true;
    button.disabled = true;
    setStatus(`Pulling ${symbol}…`);

    try {
      const response = await fetch(API_TICKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      const result = await response.json();

      if (!response.ok) {
        setStatus(result.hint ? `${result.error} ${result.hint}` : result.error, 'is-error');
        return;
      }

      setStatus(
        `${result.ticker} — ${result.name} · ${result.exchange} · ${result.bars} bars · score ${result.score}`
        + (result.replaced ? ' (updated)' : ''),
        'is-ok',
      );
      input.value = '';
      await reload();
    } catch (error) {
      setStatus(error.message, 'is-error');
    } finally {
      input.disabled = false;
      button.disabled = false;
      input.focus();
    }
  });
}

async function init() {
  const panel = qs('#universe-panel');
  if (!panel) return;

  let sort = loadSort();
  let current = [];

  const paintTable = () => {
    const sorted = sortBy(current, SORTS[sort.key].value, sort.dir);
    qs('#universe-body').replaceChildren(...renderRows(sorted));
    qs('#universe-count').textContent = describeSort(sort, current.length);
    paintSortHeaders(sort);
  };

  qs('.universe-table thead')?.addEventListener('click', (event) => {
    const th = event.target.closest('th[data-sort]');
    if (!th || !SORTS[th.dataset.sort]) return;
    const key = th.dataset.sort;
    sort = key === sort.key
      ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: SORTS[key].first || 'desc' };
    saveSort(sort);
    paintTable();
  });

  async function render() {
    // Bypass the cache: the file changed on disk a moment ago.
    const { rows, meta } = await loadUniverse({ fresh: true });
    current = rows;

    renderSourceInfo(meta, rows.length);
    renderSummary(rows, meta);
    paintTable();
    await renderMissing(rows);
  }

  try {
    await render();
    await initTickerBox(render);
  } catch (error) {
    renderError(panel, error);
  }
}

document.addEventListener('DOMContentLoaded', init);
