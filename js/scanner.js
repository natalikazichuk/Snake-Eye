/**
 * Snake Eye — scanner.
 *
 * Load universe -> apply filters -> score -> sort -> render.
 *
 * The form is driven by the schema in filters.js: an input takes part in a
 * scan as soon as its `name` matches a field key, so new filters need no
 * changes here.
 */

import { loadUniverse, loadPresets } from './api.js';
import {
  FILTER_FIELDS,
  applyFilters,
  countActiveFilters,
  criteriaFromQuery,
  criteriaToQuery,
  describeCriteria,
  emptyCriteria,
  normalizeCriteria,
} from './filters.js';
import {
  el,
  direction,
  formatCompact,
  formatMoney,
  formatMultiple,
  formatNumber,
  formatPrice,
  formatSignedPercent,
  qs,
  qsa,
  renderError,
  renderSourceInfo,
  signalDot,
  stockHref,
} from './app.js';
import { has as inWatchlist, subscribe as onWatchlistChange, toggle as toggleWatchlist } from './watchlist.js';

/* ------------------------------------------------------------ form <-> criteria */

/** Read every schema-backed input in `form` into a criteria object. */
export function readFormCriteria(form) {
  const data = new FormData(form);
  const raw = {};

  for (const field of FILTER_FIELDS) {
    if (field.type === 'set') {
      const values = data.getAll(field.key);
      if (values.length) raw[field.key] = values;
    } else if (field.type === 'flag') {
      raw[field.key] = data.has(field.key);
    } else {
      raw[field.key] = data.get(field.key);
    }
  }

  return normalizeCriteria(raw);
}

/** Write a criteria object back into the form (presets, URL restore, reset). */
export function applyCriteriaToForm(form, criteria) {
  for (const field of FILTER_FIELDS) {
    const inputs = qsa(`[name="${field.key}"]`, form);
    if (!inputs.length) continue;
    const value = criteria[field.key];

    if (field.type === 'set') {
      const selected = value || [];
      inputs.forEach((input) => {
        input.checked = selected.includes(input.value);
      });
    } else if (field.type === 'flag') {
      inputs.forEach((input) => {
        input.checked = value === true;
      });
    } else {
      inputs.forEach((input) => {
        input.value = value === undefined ? '' : String(value);
      });
    }
  }
}

/* ---------------------------------------------------------------- columns */

const COLUMNS = [
  { key: 'ticker', label: 'Ticker', sort: (row) => row.ticker, align: 'left' },
  { key: 'exchange', label: 'Exchange', sort: (row) => row.exchange, align: 'left', hideOnMobile: true },
  { key: 'price', label: 'Price', sort: (row) => row.metrics.price, align: 'right' },
  { key: 'change', label: 'Chg %', sort: (row) => row.metrics.changePercent, align: 'right' },
  { key: 'volume', label: 'Volume', sort: (row) => row.metrics.volume, align: 'right', hideOnMobile: true },
  { key: 'relVolume', label: 'RVol', sort: (row) => row.metrics.relativeVolume, align: 'right', hideOnMobile: true },
  { key: 'rsi', label: 'RSI', sort: (row) => row.metrics.rsi14, align: 'right' },
  { key: 'macd', label: 'MACD', sort: (row) => (row.metrics.macd ?? 0) - (row.metrics.macdSignal ?? 0), align: 'center', hideOnMobile: true },
  { key: 'ao', label: 'AO', sort: (row) => row.metrics.awesomeOscillator, align: 'center', hideOnMobile: true },
  { key: 'marketCap', label: 'Mkt Cap', sort: (row) => row.fundamentals.marketCap, align: 'right', hideOnMobile: true },
  { key: 'score', label: 'Snake Score', sort: (row) => row.score.total, align: 'right' },
  { key: 'watch', label: '', sortable: false, align: 'center' },
];

const state = {
  universe: [],
  matches: [],
  criteria: emptyCriteria(),
  sortKey: 'score',
  sortDir: 'desc',
  search: '',
};

/* ---------------------------------------------------------------- rendering */

function scoreCell(row) {
  return el('div', { className: 'score-cell' }, [
    el('span', { className: `score-cell__value tone-${row.score.tone}`, text: String(row.score.total) }),
    el('span', { className: 'score-cell__bar' }, [
      el('span', {
        className: `score-cell__fill tone-${row.score.tone}`,
        style: `width:${row.score.total}%`,
      }),
    ]),
  ]);
}

function watchButton(ticker) {
  const saved = inWatchlist(ticker);
  return el('button', {
    type: 'button',
    className: `watch-btn${saved ? ' is-saved' : ''}`,
    'data-watch': ticker,
    'aria-pressed': String(saved),
    title: saved ? `Remove ${ticker} from watchlist` : `Add ${ticker} to watchlist`,
    text: saved ? '👁' : '+',
  });
}

function renderRow(row) {
  const macdBullish = row.metrics.macd > row.metrics.macdSignal;
  const aoPositive = row.metrics.awesomeOscillator > 0;

  const cells = [
    el('td', { className: 'col-ticker' }, [
      el('a', { className: 'ticker-link', href: stockHref(row.ticker) }, [
        el('strong', { text: row.ticker }),
        el('span', { className: 'ticker-link__name', text: row.name }),
      ]),
    ]),
    el('td', { className: 'col-exchange num' }, [el('span', { className: 'tag', text: row.exchange })]),
    el('td', { className: 'num', text: formatPrice(row.metrics.price) }),
    el('td', { className: `num is-${direction(row.metrics.changePercent)}`, text: formatSignedPercent(row.metrics.changePercent) }),
    el('td', { className: 'num col-volume', text: formatCompact(row.metrics.volume) }),
    el('td', { className: 'num col-relVolume', text: formatMultiple(row.metrics.relativeVolume) }),
    el('td', { className: 'num', text: formatNumber(row.metrics.rsi14, 0) }),
    el('td', { className: 'center col-macd' }, [signalDot(macdBullish, macdBullish ? 'MACD above signal' : 'MACD below signal')]),
    el('td', { className: 'center col-ao' }, [signalDot(aoPositive, aoPositive ? 'AO positive' : 'AO negative')]),
    el('td', { className: 'num col-marketCap', text: formatMoney(row.fundamentals.marketCap) }),
    el('td', { className: 'num' }, [scoreCell(row)]),
    el('td', { className: 'center' }, [watchButton(row.ticker)]),
  ];

  return el('tr', { dataset: { ticker: row.ticker } }, cells);
}

function sortRows(rows) {
  const column = COLUMNS.find((col) => col.key === state.sortKey) || COLUMNS.at(-2);
  const factor = state.sortDir === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const left = column.sort(a);
    const right = column.sort(b);
    const leftMissing = left === null || left === undefined || Number.isNaN(left);
    const rightMissing = right === null || right === undefined || Number.isNaN(right);
    // Rows with no value for the sorted metric always sink to the bottom.
    if (leftMissing && rightMissing) return 0;
    if (leftMissing) return 1;
    if (rightMissing) return -1;
    if (typeof left === 'string') return left.localeCompare(right) * factor;
    return (left - right) * factor;
  });
}

function visibleRows() {
  const term = state.search.trim().toUpperCase();
  const filtered = term
    ? state.matches.filter(
        (row) => row.ticker.includes(term) || row.name.toUpperCase().includes(term),
      )
    : state.matches;
  return sortRows(filtered);
}

function renderHeader() {
  const head = qs('#results-head');
  head.replaceChildren(
    el(
      'tr',
      {},
      COLUMNS.map((column) => {
        const sorted = state.sortKey === column.key;
        const classes = [
          `align-${column.align}`,
          column.hideOnMobile ? `col-${column.key}` : '',
          column.sortable === false ? '' : 'is-sortable',
          sorted ? `is-sorted is-sorted--${state.sortDir}` : '',
        ]
          .filter(Boolean)
          .join(' ');

        const cell = el('th', {
          className: classes,
          scope: 'col',
          'aria-sort': sorted ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none',
        });

        if (column.sortable === false) {
          cell.textContent = column.label;
          return cell;
        }

        cell.append(
          el('button', {
            type: 'button',
            className: 'th-sort',
            'data-sort': column.key,
            text: column.label,
          }),
        );
        return cell;
      }),
    ),
  );
}

function renderResults() {
  const body = qs('#results-body');
  const rows = visibleRows();

  if (!rows.length) {
    body.replaceChildren(
      el('tr', {}, [
        el('td', { className: 'empty', colspan: String(COLUMNS.length) }, [
          el('p', { className: 'empty__title', text: 'No stocks matched.' }),
          el('p', {
            className: 'empty__hint',
            text: state.matches.length
              ? 'No ticker matches that search — clear the search box to see the full result set.'
              : 'Loosen a filter, widen the price range, or start from one of the saved strategies.',
          }),
        ]),
      ]),
    );
  } else {
    body.replaceChildren(...rows.map(renderRow));
  }

  qs('#results-count').textContent = `${state.matches.length} of ${state.universe.length}`;
  const shown = qs('#results-shown');
  shown.textContent = rows.length === state.matches.length ? '' : `Showing ${rows.length} after search`;

  renderHeader();
}

function renderCriteriaChips() {
  const container = qs('#active-filters');
  const chips = describeCriteria(state.criteria);
  const active = countActiveFilters(state.criteria);

  container.replaceChildren(
    ...(chips.length
      ? chips.map((chip) => el('span', { className: 'chip', text: chip }))
      : [el('span', { className: 'chip chip--muted', text: 'No filters — showing the full universe' })]),
  );
  qs('#filter-count').textContent = active ? `${active} active` : '';
}

/* -------------------------------------------------------------------- scan */

function syncUrl() {
  const query = criteriaToQuery(state.criteria).toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', url);
}

function runScan({ updateUrl = true } = {}) {
  state.matches = applyFilters(state.universe, state.criteria);
  renderCriteriaChips();
  renderResults();
  if (updateUrl) syncUrl();
}

function setCriteria(criteria, form) {
  state.criteria = normalizeCriteria(criteria);
  applyCriteriaToForm(form, state.criteria);
  runScan();
}

/* -------------------------------------------------------------- presets UI */

async function initPresets(form) {
  const container = qs('#preset-list');
  if (!container) return [];

  try {
    const presets = await loadPresets();
    container.replaceChildren(
      ...presets.map((preset) =>
        el('button', {
          type: 'button',
          className: 'preset',
          'data-preset': preset.id,
          title: preset.tagline,
        }, [
          el('span', { className: 'preset__emoji', text: preset.emoji }),
          el('span', { className: 'preset__body' }, [
            el('span', { className: 'preset__name', text: preset.name }),
            el('span', { className: 'preset__tagline', text: preset.tagline }),
          ]),
        ]),
      ),
    );

    container.addEventListener('click', (event) => {
      const button = event.target.closest('[data-preset]');
      if (!button) return;
      const preset = presets.find((item) => item.id === button.dataset.preset);
      if (!preset) return;
      qsa('.preset', container).forEach((node) => node.classList.remove('is-active'));
      button.classList.add('is-active');
      setCriteria(preset.criteria, form);
      qs('#results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    return presets;
  } catch (error) {
    renderError(container, error);
    return [];
  }
}

/* --------------------------------------------------------------- page init */

async function initScannerPage() {
  const form = qs('#scan-form');
  if (!form) return;

  const params = new URLSearchParams(window.location.search);

  try {
    const { rows, meta } = await loadUniverse();
    state.universe = rows;

    renderSourceInfo(meta, rows.length);

    // Fundamental filters silently match nothing when the provider sent no
    // fundamentals, so say it out loud instead of letting scans come back empty.
    if (meta.hasFundamentals === false) {
      qs('#fundamentals-notice')?.removeAttribute('hidden');
    }

    const presets = await initPresets(form);

    // A `preset` query parameter wins over individual filter parameters, so a
    // link like scanner.html?preset=breakout works on its own.
    const presetId = params.get('preset');
    const preset = presets.find((item) => item.id === presetId);
    if (preset) {
      qs(`[data-preset="${preset.id}"]`)?.classList.add('is-active');
      state.criteria = normalizeCriteria(preset.criteria);
    } else {
      state.criteria = criteriaFromQuery(params);
    }

    applyCriteriaToForm(form, state.criteria);
    runScan({ updateUrl: false });
  } catch (error) {
    renderError(qs('#results-panel') || document.body, error);
    return;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    qsa('.preset').forEach((node) => node.classList.remove('is-active'));
    state.criteria = readFormCriteria(form);
    runScan();
    qs('#results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  form.addEventListener('reset', () => {
    // Let the browser clear the fields first, then rescan the empty form.
    window.setTimeout(() => {
      qsa('.preset, #price-ranges .range-btn').forEach((node) => node.classList.remove('is-active'));
      setCriteria(emptyCriteria(), form);
    }, 0);
  });

  // Quick price ranges (<$5, $5-10, …) just fill the two price inputs.
  qs('#price-ranges')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-price-range]');
    if (!button) return;
    const [min, max] = button.dataset.priceRange.split(',');
    form.elements.priceMin.value = min;
    form.elements.priceMax.value = max;
    qsa('#price-ranges .range-btn').forEach((node) => node.classList.toggle('is-active', node === button));
  });

  // Typing a price by hand means the preset range no longer describes the form.
  ['priceMin', 'priceMax'].forEach((name) => {
    form.elements[name]?.addEventListener('input', () => {
      qsa('#price-ranges .range-btn').forEach((node) => node.classList.remove('is-active'));
    });
  });

  qs('#results-head').addEventListener('click', (event) => {
    const button = event.target.closest('[data-sort]');
    if (!button) return;
    const key = button.dataset.sort;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = key;
      state.sortDir = key === 'ticker' || key === 'exchange' ? 'asc' : 'desc';
    }
    renderResults();
  });

  qs('#results-search').addEventListener('input', (event) => {
    state.search = event.target.value;
    renderResults();
  });

  qs('#results-body').addEventListener('click', (event) => {
    const button = event.target.closest('[data-watch]');
    if (!button) return;
    toggleWatchlist(button.dataset.watch);
  });

  // Keep the star buttons in step with changes from any page or tab.
  onWatchlistChange(() => {
    qsa('[data-watch]').forEach((button) => {
      const saved = inWatchlist(button.dataset.watch);
      button.classList.toggle('is-saved', saved);
      button.setAttribute('aria-pressed', String(saved));
      button.textContent = saved ? '👁' : '+';
    });
  });
}

document.addEventListener('DOMContentLoaded', initScannerPage);
