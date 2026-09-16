/**
 * Snake Eye — watchlist page.
 *
 * Renders whatever is saved in `localStorage` (see watchlist.js) with fresh
 * prices and Snake Scores from the current universe.
 */

import { getStocks, loadUniverse } from './api.js';
import {
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
import { clear, list, remove, subscribe } from './watchlist.js';

function renderEmpty(container) {
  container.replaceChildren(
    el('div', { className: 'empty-state' }, [
      el('p', { className: 'empty-state__eye', text: '👁' }),
      el('h2', { text: 'Your snake list is empty' }),
      el('p', {
        className: 'empty-state__hint',
        text: 'Run a scan and tap + on any result, or add a stock from its own page.',
      }),
      el('a', { className: 'btn btn--primary', href: 'scanner.html', text: '🐍 Scan the market' }),
    ]),
  );
}

function renderCard(row) {
  const m = row.metrics;
  return el('article', { className: 'watch-card' }, [
    el('a', { className: 'watch-card__main', href: stockHref(row.ticker) }, [
      el('div', { className: 'watch-card__identity' }, [
        el('span', { className: 'watch-card__eye', text: '👁' }),
        el('div', {}, [
          el('strong', { className: 'watch-card__ticker', text: row.ticker }),
          el('span', { className: 'watch-card__name', text: row.name }),
        ]),
      ]),
      el('div', { className: 'watch-card__price' }, [
        el('span', { className: 'watch-card__last', text: formatPrice(m.price) }),
        el('span', {
          className: `watch-card__change is-${direction(m.changePercent)}`,
          text: formatSignedPercent(m.changePercent),
        }),
      ]),
      el('div', { className: 'watch-card__stats' }, [
        el('span', { text: `RSI ${formatNumber(m.rsi14, 0)}` }),
        el('span', { text: `RVol ${formatMultiple(m.relativeVolume)}` }),
        el('span', { text: `Vol ${formatCompact(m.volume)}` }),
      ]),
      el('div', { className: 'watch-card__score' }, [
        el('span', { className: `watch-card__score-value tone-${row.score.tone}`, text: String(row.score.total) }),
        el('span', { className: 'watch-card__score-label', text: row.score.label }),
      ]),
    ]),
    el('button', {
      type: 'button',
      className: 'watch-card__remove',
      'data-remove': row.ticker,
      title: `Remove ${row.ticker}`,
      text: '×',
    }),
  ]);
}

async function render() {
  const container = qs('#watchlist');
  if (!container) return;

  try {
    const { meta, rows } = await loadUniverse();
    renderSourceInfo(meta, rows.length);
  } catch {
    // The per-card render below reports loading failures properly.
  }

  const tickers = list();
  qs('#watchlist-total').textContent = tickers.length ? `${tickers.length} saved` : '';
  qs('#watchlist-clear').hidden = tickers.length === 0;

  if (!tickers.length) {
    renderEmpty(container);
    return;
  }

  try {
    const rows = await getStocks(tickers);
    container.replaceChildren(...rows.map(renderCard));
  } catch (error) {
    renderError(container, error);
  }
}

function initWatchlistPage() {
  const container = qs('#watchlist');
  if (!container) return;

  container.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove]');
    if (!button) return;
    remove(button.dataset.remove);
  });

  qs('#watchlist-clear').addEventListener('click', () => {
    if (window.confirm('Remove every stock from your watchlist?')) clear();
  });

  subscribe(render);
  render();
}

document.addEventListener('DOMContentLoaded', initWatchlistPage);
