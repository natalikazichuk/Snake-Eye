/**
 * Snake Eye — technical indicators.
 *
 * Every function takes plain number arrays and returns an array of the same
 * length, padded at the front with `null` where there is not enough history
 * yet. Keeping the arrays aligned with the input lets charts.js plot an
 * indicator against the price series without any index bookkeeping.
 */

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

/** Simple moving average. */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the first SMA of `period`. */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i];

  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing (used by RSI, ATR and ADX). */
function wilder(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;

  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i += 1) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** Relative Strength Index (Wilder, default 14). */
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  const gains = [];
  const losses = [];
  for (let i = 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    gains.push(Math.max(0, change));
    losses.push(Math.max(0, -change));
  }

  const avgGain = wilder(gains, period);
  const avgLoss = wilder(losses, period);

  for (let i = 0; i < gains.length; i += 1) {
    if (!isNum(avgGain[i]) || !isNum(avgLoss[i])) continue;
    // A flat or rising-only window has no downside: RSI is 100 by definition.
    out[i + 1] = avgLoss[i] === 0 ? 100 : 100 - 100 / (1 + avgGain[i] / avgLoss[i]);
  }
  return out;
}

/** MACD line, signal line and histogram. */
export function macd(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);

  const line = values.map((_, i) => (isNum(fast[i]) && isNum(slow[i]) ? fast[i] - slow[i] : null));

  // The signal line is an EMA of the MACD line, so it only starts once the
  // MACD line itself exists.
  const dense = line.filter(isNum);
  const denseSignal = ema(dense, signalPeriod);
  const offset = line.findIndex(isNum);

  const signal = new Array(values.length).fill(null);
  if (offset !== -1) {
    denseSignal.forEach((value, i) => {
      if (isNum(value)) signal[offset + i] = value;
    });
  }

  const histogram = values.map((_, i) =>
    isNum(line[i]) && isNum(signal[i]) ? line[i] - signal[i] : null,
  );

  return { line, signal, histogram };
}

/** Awesome Oscillator: SMA5 of the median price minus SMA34 of the median price. */
export function awesomeOscillator(high, low, fastPeriod = 5, slowPeriod = 34) {
  const median = high.map((value, i) => (value + low[i]) / 2);
  const fast = sma(median, fastPeriod);
  const slow = sma(median, slowPeriod);
  return median.map((_, i) => (isNum(fast[i]) && isNum(slow[i]) ? fast[i] - slow[i] : null));
}

/** True range series (first bar has no previous close, so it is null). */
function trueRange(high, low, close) {
  return high.map((value, i) => {
    if (i === 0) return null;
    return Math.max(
      value - low[i],
      Math.abs(value - close[i - 1]),
      Math.abs(low[i] - close[i - 1]),
    );
  });
}

/** Average True Range (Wilder, default 14). */
export function atr(high, low, close, period = 14) {
  const tr = trueRange(high, low, close).slice(1);
  const smoothed = wilder(tr, period);
  const out = new Array(high.length).fill(null);
  smoothed.forEach((value, i) => {
    out[i + 1] = value;
  });
  return out;
}

/** Average Directional Index with its +DI / -DI components. */
export function adx(high, low, close, period = 14) {
  const length = high.length;
  const empty = () => new Array(length).fill(null);
  if (length < period * 2) return { adx: empty(), plusDI: empty(), minusDI: empty() };

  const tr = [];
  const plusDM = [];
  const minusDM = [];
  for (let i = 1; i < length; i += 1) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(
      Math.max(
        high[i] - low[i],
        Math.abs(high[i] - close[i - 1]),
        Math.abs(low[i] - close[i - 1]),
      ),
    );
  }

  const smoothTR = wilder(tr, period);
  const smoothPlus = wilder(plusDM, period);
  const smoothMinus = wilder(minusDM, period);

  const plusDI = empty();
  const minusDI = empty();
  const dx = [];
  for (let i = 0; i < tr.length; i += 1) {
    if (!isNum(smoothTR[i]) || smoothTR[i] === 0) continue;
    const pdi = (smoothPlus[i] / smoothTR[i]) * 100;
    const mdi = (smoothMinus[i] / smoothTR[i]) * 100;
    plusDI[i + 1] = pdi;
    minusDI[i + 1] = mdi;
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : (Math.abs(pdi - mdi) / sum) * 100);
  }

  const smoothDX = wilder(dx, period);
  const out = empty();
  const offset = plusDI.findIndex(isNum);
  if (offset !== -1) {
    smoothDX.forEach((value, i) => {
      if (isNum(value)) out[offset + i] = value;
    });
  }

  return { adx: out, plusDI, minusDI };
}

/** Bollinger Bands with %B and bandwidth. */
export function bollingerBands(values, period = 20, deviations = 2) {
  const middle = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  const percentB = new Array(values.length).fill(null);
  const bandwidth = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i += 1) {
    if (!isNum(middle[i])) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) variance += (values[j] - middle[i]) ** 2;
    const sd = Math.sqrt(variance / period);

    upper[i] = middle[i] + sd * deviations;
    lower[i] = middle[i] - sd * deviations;
    const span = upper[i] - lower[i];
    percentB[i] = span === 0 ? 0.5 : (values[i] - lower[i]) / span;
    bandwidth[i] = middle[i] === 0 ? 0 : span / middle[i];
  }

  return { upper, middle, lower, percentB, bandwidth };
}

/** Stochastic oscillator (%K smoothed into %D). */
export function stochastic(high, low, close, period = 14, signalPeriod = 3) {
  const k = new Array(close.length).fill(null);

  for (let i = period - 1; i < close.length; i += 1) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j += 1) {
      if (high[j] > highest) highest = high[j];
      if (low[j] < lowest) lowest = low[j];
    }
    const span = highest - lowest;
    k[i] = span === 0 ? 50 : ((close[i] - lowest) / span) * 100;
  }

  const dense = k.filter(isNum);
  const denseD = sma(dense, signalPeriod);
  const offset = k.findIndex(isNum);
  const d = new Array(close.length).fill(null);
  if (offset !== -1) {
    denseD.forEach((value, i) => {
      if (isNum(value)) d[offset + i] = value;
    });
  }

  return { k, d };
}

/** Average of the last `period` values, ignoring the most recent `skip` bars. */
function averageOf(values, period, skip = 0) {
  const end = values.length - skip;
  const start = end - period;
  if (start < 0) return null;
  let sum = 0;
  for (let i = start; i < end; i += 1) sum += values[i];
  return sum / period;
}

const last = (series) => (series.length ? series[series.length - 1] : null);
const prev = (series) => (series.length > 1 ? series[series.length - 2] : null);

/**
 * Run the full indicator set over a price history and flatten it into the
 * snapshot the scanner, filters and Snake Score all read from.
 *
 * `history` is `{ close, high, low, volume }`; `series` keeps the full arrays
 * for charting, while the top-level fields are the latest reading of each.
 */
export function analyze(history) {
  const { close, high, low, volume } = history;

  const sma20 = sma(close, 20);
  const sma50 = sma(close, 50);
  const sma200 = sma(close, 200);
  const ema20 = ema(close, 20);
  const ema50 = ema(close, 50);
  const ema200 = ema(close, 200);
  const rsi14 = rsi(close, 14);
  const macdSeries = macd(close);
  const ao = awesomeOscillator(high, low);
  const adxSeries = adx(high, low, close);
  const atr14 = atr(high, low, close);
  const bands = bollingerBands(close);
  const stoch = stochastic(high, low, close);

  const price = last(close);
  const previousClose = prev(close);
  const currentVolume = last(volume);
  // Averages exclude today so relative volume compares today against its own
  // baseline rather than against a window that already contains it.
  const avgVolume20 = averageOf(volume, 20, 1);
  const avgVolume50 = averageOf(volume, 50, 1);

  const window52w = close.slice(-Math.min(close.length, 252));
  const high52w = Math.max(...window52w);
  const low52w = Math.min(...window52w);

  return {
    price,
    previousClose,
    change: isNum(previousClose) ? price - previousClose : null,
    changePercent: isNum(previousClose) && previousClose !== 0
      ? ((price - previousClose) / previousClose) * 100
      : null,

    volume: currentVolume,
    avgVolume20,
    avgVolume50,
    relativeVolume: isNum(avgVolume20) && avgVolume20 > 0 ? currentVolume / avgVolume20 : null,

    high52w,
    low52w,
    percentOf52wHigh: high52w > 0 ? (price / high52w) * 100 : null,

    sma20: last(sma20),
    sma50: last(sma50),
    sma200: last(sma200),
    ema20: last(ema20),
    ema50: last(ema50),
    ema200: last(ema200),

    rsi14: last(rsi14),
    rsi14Prev: prev(rsi14),

    macd: last(macdSeries.line),
    macdSignal: last(macdSeries.signal),
    macdHistogram: last(macdSeries.histogram),
    macdHistogramPrev: prev(macdSeries.histogram),

    awesomeOscillator: last(ao),
    awesomeOscillatorPrev: prev(ao),

    adx: last(adxSeries.adx),
    plusDI: last(adxSeries.plusDI),
    minusDI: last(adxSeries.minusDI),

    atr14: last(atr14),
    atrPercent: isNum(last(atr14)) && price > 0 ? (last(atr14) / price) * 100 : null,

    bbUpper: last(bands.upper),
    bbMiddle: last(bands.middle),
    bbLower: last(bands.lower),
    bbPercentB: last(bands.percentB),
    bbBandwidth: last(bands.bandwidth),

    stochasticK: last(stoch.k),
    stochasticD: last(stoch.d),

    series: {
      close,
      high,
      low,
      volume,
      sma20,
      sma50,
      sma200,
      ema20,
      ema50,
      ema200,
      rsi14,
      macd: macdSeries.line,
      macdSignal: macdSeries.signal,
      macdHistogram: macdSeries.histogram,
      awesomeOscillator: ao,
      adx: adxSeries.adx,
      atr14,
      bbUpper: bands.upper,
      bbLower: bands.lower,
      stochasticK: stoch.k,
      stochasticD: stoch.d,
    },
  };
}
