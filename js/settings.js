/**
 * Snake Eye — settings page.
 *
 * Read-only status for now: where the data comes from, what the browser is
 * storing, how the Snake Score is weighted, and what each stage of the
 * roadmap still has to add.
 */

import { loadUniverse } from './api.js';
import { COMPONENT_WEIGHTS } from './score.js';
import { el, formatCompact, qs, renderError } from './app.js';
import { clear, count, list } from './watchlist.js';

const ROADMAP = [
  ['MVP — filters, Snake Score, results table', 'done'],
  ['Stage 2 — price, volume, RSI, MACD and AO charts', 'done'],
  ['Stage 3 — real IBKR bars via scripts/ibkr-ingest.mjs', 'done'],
  ['Stage 4 — fundamentals (needs a Refinitiv entitlement)', 'planned'],
  ['Stage 5 — deploy (GitHub Pages, then Vercel)', 'planned'],
  ['Stage 6 — alerts on user conditions', 'planned'],
  ['Stage 7 — AI scanner (plain-language queries)', 'planned'],
];

function row(label, value, tone = '') {
  return el('div', { className: 'stat-row' }, [
    el('span', { className: 'stat-row__label', text: label }),
    el('span', { className: `stat-row__value ${tone}`.trim(), text: value }),
  ]);
}

function renderStorage() {
  const saved = list();
  qs('#storage-stats').replaceChildren(
    row('Watchlist storage', 'localStorage (this browser only)'),
    row('Saved symbols', String(count())),
    row('Symbols', saved.length ? saved.join(', ') : '—'),
  );
  qs('#clear-watchlist').disabled = count() === 0;
}

async function init() {
  const source = qs('#data-source');
  if (!source) return;

  qs('#score-weights').replaceChildren(
    ...Object.entries(COMPONENT_WEIGHTS).map(([key, weight]) =>
      row(`${key[0].toUpperCase()}${key.slice(1)} score`, `${Math.round(weight * 100)}%`),
    ),
  );

  qs('#roadmap').replaceChildren(
    ...ROADMAP.map(([label, status]) =>
      row(label, status === 'done' ? '✓ shipped' : 'planned', status === 'done' ? 'is-up' : ''),
    ),
  );

  renderStorage();
  qs('#clear-watchlist').addEventListener('click', () => {
    if (window.confirm('Remove every stock from your watchlist?')) {
      clear();
      renderStorage();
    }
  });

  try {
    const { meta, rows } = await loadUniverse();
    const bars = rows[0]?.metrics.series.close.length ?? 0;
    source.replaceChildren(
      row('Provider', meta.provider === 'IBKR' ? 'Interactive Brokers (your subscription)' : 'bundled demo data'),
      row('File', meta.source || 'data/stocks.json'),
      row('Bar size', meta.barSize || '1d'),
      row('Fundamentals', meta.hasFundamentals ? 'available' : 'not supplied — score re-weighted', meta.hasFundamentals ? 'is-up' : ''),
      row('Symbols', String(rows.length)),
      row('Sessions per symbol', String(bars)),
      row('First session', meta.firstSession || '—'),
      row('Last session', meta.lastSession || '—'),
      row('Generated', meta.generatedAt ? meta.generatedAt.slice(0, 10) : '—'),
      row('Data points', formatCompact(rows.length * bars * 4, 1)),
    );
  } catch (error) {
    renderError(source, error);
  }
}

document.addEventListener('DOMContentLoaded', init);
