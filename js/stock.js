/**
 * Snake Eye — single stock page.
 *
 * Reads `?ticker=ABC`, then renders the header, the Snake Score breakdown,
 * the chart stack (price + volume + RSI + MACD + AO) and the indicator and
 * fundamental tables.
 */

import { getStock } from './api.js';
import { awesomeChart, macdChart, priceChart, rsiChart, volumeChart } from './charts.js';
import {
  DASH,
  direction,
  el,
  formatCompact,
  formatMoney,
  formatMultiple,
  formatNumber,
  formatPrice,
  formatRatioPercent,
  formatSignedPercent,
  qs,
  qsa,
  renderError,
} from './app.js';
import { has as inWatchlist, subscribe as onWatchlistChange, toggle as toggleWatchlist } from './watchlist.js';

const COMPONENT_LABELS = {
  technical: 'Technical',
  momentum: 'Momentum',
  volume: 'Volume',
  fundamental: 'Fundamental',
};

const charts = [];
let currentBars = 180;

function metricCard(label, value, tone = '') {
  return el('div', { className: 'metric' }, [
    el('span', { className: 'metric__label', text: label }),
    el('span', { className: `metric__value ${tone}`.trim(), text: value }),
  ]);
}

function statRow(label, value, tone = '') {
  return el('div', { className: 'stat-row' }, [
    el('span', { className: 'stat-row__label', text: label }),
    el('span', { className: `stat-row__value ${tone}`.trim(), text: value }),
  ]);
}

function renderHeader(row) {
  const m = row.metrics;
  document.title = `${row.ticker} · ${formatPrice(m.price)} — Snake Eye`;

  qs('#stock-ticker').textContent = row.ticker;
  qs('#stock-name').textContent = row.name;
  qs('#stock-exchange').textContent = row.exchange;
  qs('#stock-sector').textContent = row.sector;
  qs('#stock-price').textContent = formatPrice(m.price);

  const change = qs('#stock-change');
  change.textContent = `${m.change >= 0 ? '+' : ''}${formatNumber(m.change, 2)} (${formatSignedPercent(m.changePercent)})`;
  change.className = `stock-hero__change is-${direction(m.changePercent)}`;
}

function renderScore(row) {
  const { score } = row;
  qs('#score-value').textContent = String(score.total);
  qs('#score-label').textContent = score.label;
  qs('#score-label').className = `score-panel__label tone-${score.tone}`;

  const bar = qs('#score-bar-fill');
  bar.style.width = `${score.total}%`;
  bar.className = `score-bar__fill tone-${score.tone}`;

  qs('#score-components').replaceChildren(
    ...Object.entries(score.components).map(([key, component]) =>
      el('div', { className: 'score-component' }, [
        el('div', { className: 'score-component__head' }, [
          el('span', { className: 'score-component__name', text: COMPONENT_LABELS[key] }),
          el('span', { className: 'score-component__value', text: `${component.score}` }),
        ]),
        el('div', { className: 'score-bar score-bar--slim' }, [
          el('span', { className: 'score-bar__fill', style: `width:${component.score}%` }),
        ]),
        el(
          'ul',
          { className: 'score-component__items' },
          component.items.map((item) =>
            el('li', { className: item.points > 0 ? 'is-hit' : 'is-miss' }, [
              el('span', { className: 'score-item__label', text: item.label }),
              el('span', {
                className: 'score-item__points',
                text: `${item.points.toFixed(item.points % 1 === 0 ? 0 : 1)} / ${item.max}`,
              }),
            ]),
          ),
        ),
      ]),
    ),
  );
}

function renderIndicators(row) {
  const m = row.metrics;
  const macdBullish = m.macd > m.macdSignal;

  qs('#indicator-cards').replaceChildren(
    metricCard('RSI (14)', formatNumber(m.rsi14, 1), m.rsi14 > 70 ? 'is-down' : m.rsi14 < 30 ? 'is-up' : ''),
    metricCard('MACD', formatNumber(m.macd, 3), macdBullish ? 'is-up' : 'is-down'),
    metricCard('Awesome Osc.', formatNumber(m.awesomeOscillator, 3), m.awesomeOscillator > 0 ? 'is-up' : 'is-down'),
    metricCard('ADX (14)', formatNumber(m.adx, 1)),
    metricCard('ATR (14)', `${formatNumber(m.atr14, 2)} (${formatNumber(m.atrPercent, 1)}%)`),
    metricCard('Rel. volume', formatMultiple(m.relativeVolume), m.relativeVolume >= 1.5 ? 'is-up' : ''),
  );

  qs('#indicator-details').replaceChildren(
    statRow('MACD signal', formatNumber(m.macdSignal, 3)),
    statRow('MACD histogram', formatNumber(m.macdHistogram, 3), m.macdHistogram > 0 ? 'is-up' : 'is-down'),
    statRow('+DI / -DI', `${formatNumber(m.plusDI, 1)} / ${formatNumber(m.minusDI, 1)}`),
    statRow('Stochastic %K / %D', `${formatNumber(m.stochasticK, 1)} / ${formatNumber(m.stochasticD, 1)}`),
    statRow('Bollinger upper', formatPrice(m.bbUpper)),
    statRow('Bollinger middle', formatPrice(m.bbMiddle)),
    statRow('Bollinger lower', formatPrice(m.bbLower)),
    statRow('Bollinger %B', formatNumber(m.bbPercentB, 2)),
  );

  const maRow = (label, value) =>
    statRow(
      label,
      value === null ? DASH : `${formatPrice(value)} (${m.price > value ? 'above' : 'below'})`,
      value === null ? '' : m.price > value ? 'is-up' : 'is-down',
    );

  qs('#moving-averages').replaceChildren(
    maRow('SMA 20', m.sma20),
    maRow('SMA 50', m.sma50),
    maRow('SMA 200', m.sma200),
    maRow('EMA 20', m.ema20),
    maRow('EMA 50', m.ema50),
    maRow('EMA 200', m.ema200),
  );

  qs('#volume-stats').replaceChildren(
    statRow('Volume', formatCompact(m.volume)),
    statRow('Average volume (20d)', formatCompact(m.avgVolume20)),
    statRow('Average volume (50d)', formatCompact(m.avgVolume50)),
    statRow('Relative volume', formatMultiple(m.relativeVolume)),
    statRow('52-week high', formatPrice(m.high52w)),
    statRow('52-week low', formatPrice(m.low52w)),
    statRow('% of 52-week high', `${formatNumber(m.percentOf52wHigh, 1)}%`),
  );
}

function renderFundamentals(row) {
  const f = row.fundamentals;
  qs('#fundamentals').replaceChildren(
    statRow('Market cap', formatMoney(f.marketCap)),
    statRow('Revenue (TTM)', formatMoney(f.revenue)),
    statRow('Revenue growth', formatRatioPercent(f.revenueGrowth), f.revenueGrowth > 0 ? 'is-up' : 'is-down'),
    statRow('EPS', formatNumber(f.eps, 2), f.eps > 0 ? 'is-up' : 'is-down'),
    statRow('EPS growth', formatRatioPercent(f.epsGrowth), f.epsGrowth > 0 ? 'is-up' : 'is-down'),
    statRow('P/E', f.pe === null ? 'n/a (no earnings)' : formatNumber(f.pe, 1)),
    statRow('P/S', formatNumber(f.ps, 1)),
    statRow('ROE', formatRatioPercent(f.roe), f.roe > 0 ? 'is-up' : 'is-down'),
    statRow('Debt / equity', formatNumber(f.debtEquity, 2)),
    statRow('Gross margin', formatRatioPercent(f.grossMargin)),
    statRow('Operating margin', formatRatioPercent(f.operatingMargin)),
    statRow('Current ratio', formatNumber(f.currentRatio, 2)),
  );
}

/** Shared hover readout: one crosshair index, every panel reports the same bar. */
function renderReadout(row, index) {
  const readout = qs('#chart-readout');
  const s = row.metrics.series;
  const i = index === null ? s.close.length - 1 : index;

  readout.replaceChildren(
    el('span', { className: 'readout__date', text: row.dates[i] }),
    el('span', {}, [el('em', { text: 'C ' }), formatPrice(s.close[i])]),
    el('span', {}, [el('em', { text: 'H ' }), formatPrice(s.high[i])]),
    el('span', {}, [el('em', { text: 'L ' }), formatPrice(s.low[i])]),
    el('span', {}, [el('em', { text: 'Vol ' }), formatCompact(s.volume[i])]),
    el('span', {}, [el('em', { text: 'RSI ' }), formatNumber(s.rsi14[i], 1)]),
    el('span', {}, [el('em', { text: 'MACD ' }), formatNumber(s.macd[i], 3)]),
    el('span', {}, [el('em', { text: 'AO ' }), formatNumber(s.awesomeOscillator[i], 3)]),
  );
}

function renderCharts(row) {
  const onHover = (index) => renderReadout(row, index);
  const options = { bars: currentBars, onHover };

  charts.length = 0;
  charts.push(
    priceChart(qs('#chart-price'), row, options),
    volumeChart(qs('#chart-volume'), row, options),
    rsiChart(qs('#chart-rsi'), row, options),
    macdChart(qs('#chart-macd'), row, options),
    awesomeChart(qs('#chart-ao'), row, options),
  );

  renderReadout(row, null);

  qs('#range-controls').addEventListener('click', (event) => {
    const button = event.target.closest('[data-bars]');
    if (!button) return;
    const total = row.metrics.series.close.length;
    currentBars = button.dataset.bars === 'all' ? total : Number(button.dataset.bars);
    qsa('#range-controls [data-bars]').forEach((node) => node.classList.toggle('is-active', node === button));
    charts.forEach((chart) => chart.update({ bars: currentBars }));
  });
}

function initWatchButton(row) {
  const button = qs('#watch-toggle');

  const paint = () => {
    const saved = inWatchlist(row.ticker);
    button.textContent = saved ? '👁 On watchlist' : '👁 Add to watchlist';
    button.classList.toggle('is-saved', saved);
    button.setAttribute('aria-pressed', String(saved));
  };

  button.addEventListener('click', () => toggleWatchlist(row.ticker));
  onWatchlistChange(paint);
  paint();
}

function renderNotFound(ticker) {
  qs('#stock-page').replaceChildren(
    el('div', { className: 'notice' }, [
      el('h1', { text: ticker ? `${ticker} is not in this universe` : 'No ticker selected' }),
      el('p', {
        text: ticker
          ? 'Snake Eye runs on a fixed demo universe. Pick a symbol from the scanner instead.'
          : 'Open a stock from the scanner results, or add ?ticker=ABC to the address.',
      }),
      el('a', { className: 'btn btn--primary', href: 'scanner.html', text: 'Back to the scanner' }),
    ]),
  );
}

async function initStockPage() {
  const page = qs('#stock-page');
  if (!page) return;

  const ticker = new URLSearchParams(window.location.search).get('ticker');

  try {
    const row = ticker ? await getStock(ticker) : null;
    if (!row) {
      renderNotFound(ticker ? ticker.toUpperCase() : '');
      return;
    }

    page.classList.remove('is-loading');
    renderHeader(row);
    renderScore(row);
    renderIndicators(row);
    renderFundamentals(row);
    renderCharts(row);
    initWatchButton(row);
  } catch (error) {
    renderError(page, error);
  }
}

document.addEventListener('DOMContentLoaded', initStockPage);
