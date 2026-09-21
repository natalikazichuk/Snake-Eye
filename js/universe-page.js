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

async function init() {
  const panel = qs('#universe-panel');
  if (!panel) return;

  try {
    const { rows, meta } = await loadUniverse();

    renderSourceInfo(meta, rows.length);
    renderSummary(rows, meta);
    qs('#universe-body').replaceChildren(...renderRows(rows));
    qs('#universe-count').textContent = `${rows.length} symbols, highest score first`;

    await renderMissing(rows);
  } catch (error) {
    renderError(panel, error);
  }
}

document.addEventListener('DOMContentLoaded', init);
