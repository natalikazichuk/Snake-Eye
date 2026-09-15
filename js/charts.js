/**
 * Snake Eye — charts.
 *
 * A small canvas renderer for the price, volume and oscillator panels on the
 * stock page. No charting library: the shapes needed here are lines, areas,
 * bars and a signed histogram, and a dependency-free MVP deploys to GitHub
 * Pages as-is.
 *
 *   createChart(canvas, spec) -> { update(patch), destroy() }
 *
 * `spec.series` entries are `{ data, type, color, width, fill, label }` where
 * `data` is aligned with `spec.dates` and may contain nulls for bars that have
 * no value yet (an indicator still warming up).
 */

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

const AXIS_FONT = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
const PADDING = { top: 12, right: 58, bottom: 22, left: 10 };

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Theme colours, read from CSS so charts follow the stylesheet. */
export function palette() {
  return {
    up: cssVar('--up', '#25d07a'),
    down: cssVar('--down', '#ff4d67'),
    grid: cssVar('--chart-grid', 'rgba(255,255,255,0.07)'),
    axis: cssVar('--text-dim', '#7d8a99'),
    price: cssVar('--accent', '#25d07a'),
    sma20: cssVar('--chart-sma20', '#7bd7ff'),
    sma50: cssVar('--chart-sma50', '#f7c948'),
    sma200: cssVar('--chart-sma200', '#b48cff'),
    neutral: cssVar('--text-dim', '#7d8a99'),
  };
}

function niceTicks(min, max, count = 4) {
  if (!isNum(min) || !isNum(max) || min === max) return [min];
  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
  const ticks = [];
  for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step) {
    ticks.push(value);
  }
  return ticks;
}

export function createChart(canvas, spec) {
  const ctx = canvas.getContext('2d');
  let current = { height: 200, ...spec };
  let hoverIndex = null;

  function visibleWindow() {
    const total = current.dates?.length || current.series?.[0]?.data.length || 0;
    const bars = Math.min(current.bars || total, total);
    return { start: total - bars, end: total };
  }

  function domain(start, end) {
    let min = current.min;
    let max = current.max;
    let dataMin = Infinity;
    let dataMax = -Infinity;

    for (const series of current.series) {
      for (let i = start; i < end; i += 1) {
        const value = series.data[i];
        if (!isNum(value)) continue;
        if (value < dataMin) dataMin = value;
        if (value > dataMax) dataMax = value;
      }
    }
    if (!isNum(dataMin)) return { min: 0, max: 1 };

    if (current.includeZero) {
      dataMin = Math.min(dataMin, 0);
      dataMax = Math.max(dataMax, 0);
    }
    if (current.symmetric) {
      const bound = Math.max(Math.abs(dataMin), Math.abs(dataMax)) || 1;
      dataMin = -bound;
      dataMax = bound;
    }

    const pad = (dataMax - dataMin) * 0.08 || Math.abs(dataMax || 1) * 0.1;
    return {
      min: isNum(min) ? min : dataMin - pad,
      max: isNum(max) ? max : dataMax + pad,
    };
  }

  function draw() {
    const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 600;
    const height = current.height;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const { start, end } = visibleWindow();
    const bars = end - start;
    if (bars <= 0) return;

    const plotLeft = PADDING.left;
    const plotRight = width - PADDING.right;
    const plotTop = PADDING.top;
    const plotBottom = height - PADDING.bottom;
    const plotWidth = Math.max(1, plotRight - plotLeft);
    const plotHeight = Math.max(1, plotBottom - plotTop);

    const { min, max } = domain(start, end);
    const span = max - min || 1;
    const x = (index) => plotLeft + ((index - start) / Math.max(1, bars - 1)) * plotWidth;
    const y = (value) => plotBottom - ((value - min) / span) * plotHeight;

    const colors = palette();

    // Horizontal bands (for example the RSI 30-70 zone).
    for (const band of current.bands || []) {
      const top = y(Math.min(band.to, max));
      const bottom = y(Math.max(band.from, min));
      ctx.fillStyle = band.color || 'rgba(255,255,255,0.04)';
      ctx.fillRect(plotLeft, top, plotWidth, Math.max(0, bottom - top));
    }

    // Grid and right-hand value axis.
    ctx.strokeStyle = colors.grid;
    ctx.fillStyle = colors.axis;
    ctx.font = AXIS_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (const tick of niceTicks(min, max, current.ticks || 4)) {
      if (tick < min || tick > max) continue;
      const ty = Math.round(y(tick)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(plotLeft, ty);
      ctx.lineTo(plotRight, ty);
      ctx.stroke();
      ctx.fillText((current.formatValue || String)(tick), plotRight + 8, ty);
    }

    // Reference levels (zero line, RSI 30/70, …).
    for (const level of current.levels || []) {
      if (level.value < min || level.value > max) continue;
      const ly = Math.round(y(level.value)) + 0.5;
      ctx.save();
      ctx.strokeStyle = level.color || colors.axis;
      ctx.setLineDash(level.dashed === false ? [] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(plotLeft, ly);
      ctx.lineTo(plotRight, ly);
      ctx.stroke();
      ctx.restore();
    }

    for (const series of current.series) {
      if (series.type === 'bar' || series.type === 'histogram') {
        const barWidth = Math.max(1, plotWidth / bars - 1);
        const baseline = series.type === 'histogram' ? y(0) : plotBottom;
        for (let i = start; i < end; i += 1) {
          const value = series.data[i];
          if (!isNum(value)) continue;
          const top = y(value);
          ctx.fillStyle = series.colorFor
            ? series.colorFor(value, i)
            : series.color || colors.neutral;
          ctx.fillRect(
            x(i) - barWidth / 2,
            Math.min(top, baseline),
            barWidth,
            Math.max(1, Math.abs(baseline - top)),
          );
        }
        continue;
      }

      // Lines, drawn as segments so gaps in the data stay gaps.
      ctx.strokeStyle = series.color || colors.price;
      ctx.lineWidth = series.width || 1.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let drawing = false;
      for (let i = start; i < end; i += 1) {
        const value = series.data[i];
        if (!isNum(value)) {
          drawing = false;
          continue;
        }
        if (drawing) ctx.lineTo(x(i), y(value));
        else {
          ctx.moveTo(x(i), y(value));
          drawing = true;
        }
      }
      ctx.stroke();

      if (series.fill) {
        ctx.lineTo(x(end - 1), plotBottom);
        ctx.lineTo(x(start), plotBottom);
        ctx.closePath();
        const gradient = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
        gradient.addColorStop(0, series.fill);
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.fill();
      }
    }

    // Date axis: first, middle and last visible session.
    if (current.dates?.length) {
      ctx.fillStyle = colors.axis;
      ctx.textBaseline = 'top';
      const marks = [start, start + Math.floor(bars / 2), end - 1];
      marks.forEach((index, position) => {
        const label = current.dates[index];
        if (!label) return;
        ctx.textAlign = position === 0 ? 'left' : position === 1 ? 'center' : 'right';
        ctx.fillText(label.slice(5), x(index), plotBottom + 6);
      });
    }

    if (hoverIndex !== null && hoverIndex >= start && hoverIndex < end) {
      const hx = Math.round(x(hoverIndex)) + 0.5;
      ctx.strokeStyle = colors.axis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, plotTop);
      ctx.lineTo(hx, plotBottom);
      ctx.stroke();

      for (const series of current.series) {
        const value = series.data[hoverIndex];
        if (!isNum(value) || series.type === 'bar' || series.type === 'histogram') continue;
        ctx.fillStyle = series.color || colors.price;
        ctx.beginPath();
        ctx.arc(hx, y(value), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function indexFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const { start, end } = visibleWindow();
    const bars = end - start;
    const plotLeft = PADDING.left;
    const plotWidth = Math.max(1, rect.width - PADDING.right - plotLeft);
    const ratio = (event.clientX - rect.left - plotLeft) / plotWidth;
    return Math.max(start, Math.min(end - 1, start + Math.round(ratio * (bars - 1))));
  }

  function onMove(event) {
    const index = indexFromEvent(event);
    if (index === hoverIndex) return;
    hoverIndex = index;
    current.onHover?.(index);
    draw();
  }

  function onLeave() {
    if (hoverIndex === null) return;
    hoverIndex = null;
    current.onHover?.(null);
    draw();
  }

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('touchmove', (event) => {
    if (event.touches[0]) onMove(event.touches[0]);
  }, { passive: true });
  canvas.addEventListener('touchend', onLeave);

  const observer = new ResizeObserver(() => draw());
  observer.observe(canvas.parentElement || canvas);
  draw();

  return {
    update(patch) {
      current = { ...current, ...patch };
      draw();
    },
    redraw: draw,
    destroy() {
      observer.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
    },
  };
}

/** Price with its moving averages — the main panel on the stock page. */
export function priceChart(canvas, row, options = {}) {
  const colors = palette();
  const s = row.metrics.series;
  return createChart(canvas, {
    height: options.height || 320,
    bars: options.bars || 180,
    dates: row.dates,
    formatValue: (value) => `$${value.toFixed(value < 10 ? 2 : 0)}`,
    series: [
      { label: 'SMA200', data: s.sma200, color: colors.sma200, width: 1.2 },
      { label: 'SMA50', data: s.sma50, color: colors.sma50, width: 1.2 },
      { label: 'SMA20', data: s.sma20, color: colors.sma20, width: 1.2 },
      {
        label: 'Price',
        data: s.close,
        color: colors.price,
        width: 2,
        fill: 'rgba(37, 208, 122, 0.18)',
      },
    ],
    onHover: options.onHover,
  });
}

/** Volume bars, coloured by whether the session closed up or down. */
export function volumeChart(canvas, row, options = {}) {
  const s = row.metrics.series;
  return createChart(canvas, {
    height: options.height || 120,
    bars: options.bars || 180,
    dates: row.dates,
    min: 0,
    ticks: 2,
    formatValue: (value) => (value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : `${Math.round(value / 1e3)}K`),
    series: [
      {
        label: 'Volume',
        data: s.volume,
        type: 'bar',
        colorFor: (_value, i) => {
          const rising = i > 0 && s.close[i] >= s.close[i - 1];
          return rising ? 'rgba(37,208,122,0.55)' : 'rgba(255,77,103,0.55)';
        },
      },
    ],
    onHover: options.onHover,
  });
}

/** RSI with its 30 / 70 reference levels. */
export function rsiChart(canvas, row, options = {}) {
  const colors = palette();
  return createChart(canvas, {
    height: options.height || 140,
    bars: options.bars || 180,
    dates: row.dates,
    min: 0,
    max: 100,
    ticks: 2,
    formatValue: (value) => value.toFixed(0),
    bands: [{ from: 30, to: 70, color: 'rgba(255,255,255,0.035)' }],
    levels: [
      { value: 70, color: colors.down },
      { value: 30, color: colors.up },
    ],
    series: [{ label: 'RSI(14)', data: row.metrics.series.rsi14, color: cssVar('--chart-rsi', '#7bd7ff'), width: 1.6 }],
    onHover: options.onHover,
  });
}

/** MACD line, signal line and histogram. */
export function macdChart(canvas, row, options = {}) {
  const colors = palette();
  const s = row.metrics.series;
  return createChart(canvas, {
    height: options.height || 150,
    bars: options.bars || 180,
    dates: row.dates,
    includeZero: true,
    ticks: 3,
    formatValue: (value) => value.toFixed(2),
    levels: [{ value: 0, color: colors.axis, dashed: false }],
    series: [
      {
        label: 'Histogram',
        data: s.macdHistogram,
        type: 'histogram',
        colorFor: (value) => (value >= 0 ? 'rgba(37,208,122,0.5)' : 'rgba(255,77,103,0.5)'),
      },
      { label: 'Signal', data: s.macdSignal, color: colors.sma50, width: 1.3 },
      { label: 'MACD', data: s.macd, color: colors.sma20, width: 1.6 },
    ],
    onHover: options.onHover,
  });
}

/** Awesome Oscillator, coloured by whether each bar is higher than the last. */
export function awesomeChart(canvas, row, options = {}) {
  const colors = palette();
  const data = row.metrics.series.awesomeOscillator;
  return createChart(canvas, {
    height: options.height || 140,
    bars: options.bars || 180,
    dates: row.dates,
    includeZero: true,
    ticks: 3,
    formatValue: (value) => value.toFixed(2),
    levels: [{ value: 0, color: colors.axis, dashed: false }],
    series: [
      {
        label: 'AO',
        data,
        type: 'histogram',
        colorFor: (value, i) => {
          const rising = i > 0 && isNum(data[i - 1]) ? value >= data[i - 1] : value >= 0;
          return rising ? 'rgba(37,208,122,0.65)' : 'rgba(255,77,103,0.65)';
        },
      },
    ],
    onHover: options.onHover,
  });
}
