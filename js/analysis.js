/**
 * Snake Eye — the case for and against, in words (Ukrainian).
 *
 * Every sentence is derived from a number already on the page: each rule below
 * checks one condition and, when it holds, says what it is and why it matters.
 * Rules carry a weight; each side keeps its strongest five and opens with a
 * one-line verdict, so the reader gets six sentences at most per side. A side
 * with fewer than four points is topped up with the levels that would change
 * the picture, so a weak case still reads as five sentences, not two.
 *
 * Pure — no DOM — so tests/analysis.test.mjs can drive it with plain rows.
 * It describes the setup. It does not predict the price and is not advice.
 */

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const price = (value) => `$${value.toFixed(value < 1 ? 3 : 2)}`;
const pct = (value, digits = 0) => `${value.toFixed(digits)}%`;
const ratioPct = (value) => `${(value * 100).toFixed(0)}%`;
const gap = (a, b) => ((a - b) / b) * 100;

const MAX_POINTS = 5;

/** Rules that argue for owning it. Each returns a sentence or null. */
const BULL = [
  [10, ({ m }) => isNum(m.sma20) && isNum(m.sma50) && isNum(m.sma200) && m.sma20 > m.sma50 && m.sma50 > m.sma200
    ? '20-, 50- і 200-денні середні вишикувані в бичачому порядку — класична картина сталого висхідного тренду.'
    : null],
  [9, ({ m }) => isNum(m.sma200) && m.price > m.sma200
    ? `Ціна на ${pct(gap(m.price, m.sma200))} вища за 200-денну середню (${price(m.sma200)}), тож довгостроковий тренд спрямований угору.`
    : null],
  [7, ({ m }) => isNum(m.sma50) && isNum(m.sma20) && m.price > m.sma20 && m.price > m.sma50
    ? `Вона також тримається вище 20-денної (${price(m.sma20)}) і 50-денної (${price(m.sma50)}) середніх — короткий і середній тренди збігаються.`
    : null],
  [8, ({ m }) => isNum(m.macd) && isNum(m.macdSignal) && m.macd > m.macdSignal
    ? `MACD вище сигнальної лінії${isNum(m.macdHistogram) && isNum(m.macdHistogramPrev) && m.macdHistogram > m.macdHistogramPrev ? ', і розрив між ними зростає' : ''} — імпульс на боці покупців.`
    : null],
  [6, ({ m }) => isNum(m.awesomeOscillator) && m.awesomeOscillator > 0 && isNum(m.awesomeOscillatorPrev) && m.awesomeOscillator > m.awesomeOscillatorPrev
    ? 'Awesome Oscillator додатний і зростає — ще одне підтвердження імпульсу.'
    : null],
  [7, ({ m }) => isNum(m.rsi14) && m.rsi14 >= 45 && m.rsi14 <= 65
    ? `RSI ${m.rsi14.toFixed(0)} — у здоровій зоні: достатньо сили для тренду і ще є запас до перекупленості.`
    : null],
  [6, ({ m }) => isNum(m.rsi14) && m.rsi14 < 30
    ? `RSI ${m.rsi14.toFixed(0)} — перепроданість; такий односторонній продаж часто вичерпується і змінюється відскоком.`
    : null],
  [8, ({ m }) => isNum(m.adx) && m.adx >= 25 && isNum(m.plusDI) && isNum(m.minusDI) && m.plusDI > m.minusDI
    ? `ADX ${m.adx.toFixed(0)} при +DI вище -DI: рух угору має справжню силу, а не просто дрейф.`
    : null],
  [7, ({ m }) => isNum(m.relativeVolume) && m.relativeVolume >= 1.5 && isNum(m.changePercent) && m.changePercent > 0
    ? `Сьогоднішнє зростання пройшло на обсязі в ${m.relativeVolume.toFixed(1)} раза вищому за звичайний — покупці заходять великими сумами.`
    : null],
  [6, ({ m }) => isNum(m.percentOf52wHigh) && m.percentOf52wHigh >= 95
    ? `Ціна на рівні ${pct(m.percentOf52wHigh)} від річного максимуму (${price(m.high52w)}), тож згори майже немає власників, які чекають нагоди вийти «в нуль».`
    : null],
  [4, ({ m }) => isNum(m.stochasticK) && isNum(m.stochasticD) && m.stochasticK > m.stochasticD && m.stochasticK < 30
    ? 'Стохастик розвернувся вгору із зони перепроданості — ранній знак відскоку.'
    : null],
  [7, ({ f }) => isNum(f.revenueGrowth) && f.revenueGrowth >= 0.1
    ? `Виручка за останній фінансовий рік зросла на ${ratioPct(f.revenueGrowth)} — бізнес за графіком розширюється.`
    : null],
  [6, ({ f }) => isNum(f.eps) && f.eps > 0 && isNum(f.pe) && f.pe > 0 && f.pe < 18
    ? `Компанія прибуткова й оцінена у ${f.pe.toFixed(1)} річного прибутку — це помірно.`
    : null],
  [5, ({ f }) => isNum(f.roe) && f.roe >= 0.15
    ? `Рентабельність капіталу ${ratioPct(f.roe)} — компанія добре заробляє на капіталі власників.`
    : null],
  [4, ({ f }) => isNum(f.debtEquity) && f.debtEquity >= 0 && f.debtEquity < 0.5
    ? `Борг невеликий (${f.debtEquity.toFixed(2)} від власного капіталу), тож є запас пережити поганий рік.`
    : null],
];

/** Rules that argue against it. */
const BEAR = [
  [10, ({ m }) => isNum(m.sma20) && isNum(m.sma50) && isNum(m.sma200) && m.sma20 < m.sma50 && m.sma50 < m.sma200
    ? '20-, 50- і 200-денні середні вишикувані у ведмежому порядку — картина сталого низхідного тренду.'
    : null],
  [9, ({ m }) => isNum(m.sma200) && m.price < m.sma200
    ? `Ціна на ${pct(-gap(m.price, m.sma200))} нижча за 200-денну середню (${price(m.sma200)}): довгостроковий тренд досі спрямований униз.`
    : null],
  [6, ({ m }) => isNum(m.sma50) && m.price < m.sma50
    ? `Вона торгується нижче 50-денної середньої (${price(m.sma50)}), яка на відскоках зазвичай стає опором.`
    : null],
  [8, ({ m }) => isNum(m.macd) && isNum(m.macdSignal) && m.macd < m.macdSignal
    ? 'MACD нижче сигнальної лінії — короткостроковий імпульс на боці продавців.'
    : null],
  [5, ({ m }) => isNum(m.macd) && isNum(m.macdSignal) && m.macd > m.macdSignal && isNum(m.macdHistogram) && isNum(m.macdHistogramPrev) && m.macdHistogram < m.macdHistogramPrev
    ? 'MACD поки вище сигнальної лінії, але гістограма скорочується — імпульс згасає.'
    : null],
  [6, ({ m }) => isNum(m.awesomeOscillator) && m.awesomeOscillator < 0
    ? 'Awesome Oscillator нижче нуля — ще одна ознака негативного імпульсу.'
    : null],
  [8, ({ m }) => isNum(m.rsi14) && m.rsi14 > 70
    ? `RSI ${m.rsi14.toFixed(0)} — перекупленість: після такого крутого зростання часто буває пауза або відкат, а купівля тут означає переплату.`
    : null],
  [5, ({ m }) => isNum(m.rsi14) && m.rsi14 >= 30 && m.rsi14 < 40
    ? `RSI ${m.rsi14.toFixed(0)} показує слабкий імпульс, але ще не настільки низький, щоб чекати відскоку.`
    : null],
  [8, ({ m }) => isNum(m.adx) && m.adx >= 25 && isNum(m.plusDI) && isNum(m.minusDI) && m.minusDI > m.plusDI
    ? `ADX ${m.adx.toFixed(0)} при -DI вище +DI — сильний низхідний тренд, іти проти нього дорого.`
    : null],
  [7, ({ m }) => isNum(m.relativeVolume) && m.relativeVolume >= 1.5 && isNum(m.changePercent) && m.changePercent < 0
    ? `Сьогоднішнє падіння пройшло на обсязі в ${m.relativeVolume.toFixed(1)} раза вищому за звичайний — це схоже на розпродаж, а не на шум.`
    : null],
  [8, ({ m }) => isNum(m.bbPercentB) && m.bbPercentB > 1
    ? `Ціна закрилася вище верхньої смуги Боллінджера (${price(m.bbUpper)}) — статистично «розтягнута»; такі рухи часто повертаються до середньої смуги (${price(m.bbMiddle)}).`
    : null],
  [9, ({ m }) => isNum(m.avgVolume20) && m.avgVolume20 < 100_000
    ? `Ліквідність низька — близько ${Math.round(m.avgVolume20 / 1000)} тис. акцій на день: спред ширший, і велика заявка може зсунути ціну проти вас.`
    : null],
  [4, ({ m }) => isNum(m.relativeVolume) && m.relativeVolume < 0.6
    ? `Обсяг лише ${m.relativeVolume.toFixed(1)} від звичайного, тож за сьогоднішнім рухом мало переконаності.`
    : null],
  [6, ({ m }) => isNum(m.percentOf52wHigh) && m.percentOf52wHigh < 70
    ? `Ціна на ${pct(100 - m.percentOf52wHigh)} нижча за річний максимум, і ті, хто купив вище, можуть продавати на будь-якому відновленні.`
    : null],
  [5, ({ m }) => isNum(m.atrPercent) && m.atrPercent >= 5
    ? `Вона коливається приблизно на ${pct(m.atrPercent, 1)} за день (ATR), тож стоп-лос доведеться ставити далеко, а позицію — зменшувати.`
    : null],
  [8, ({ f }) => isNum(f.eps) && f.eps < 0
    ? 'Компанія була збиткова в останньому фінансовому році, тож ціна тримається на очікуваннях, а не на прибутку.'
    : null],
  [7, ({ f }) => isNum(f.revenueGrowth) && f.revenueGrowth < 0
    ? `Виручка минулого року скоротилася на ${ratioPct(-f.revenueGrowth)}.`
    : null],
  [5, ({ f }) => isNum(f.pe) && f.pe > 40
    ? `При P/E ${f.pe.toFixed(0)} оцінка вже закладає дуже багато майбутнього зростання.`
    : null],
  [5, ({ f }) => isNum(f.debtEquity) && f.debtEquity > 2
    ? `Борг великий (${f.debtEquity.toFixed(1)} від власного капіталу), що посилить будь-який спад.`
    : null],
  [7, ({ security }) => security?.kind === 'fund'
    ? 'Це фонд: його ціна може бути вищою або нижчою за вартість активів (NAV), чого ці графіки не показують, — перевірте NAV, перш ніж діяти за графіком.'
    : null],
  [6, ({ security }) => security?.kind === 'adr' || security?.kind === 'foreign'
    ? `Це іноземна компанія${security.country ? ` (${security.country})` : ''}: валютний ризик і ризик її домашнього ринку американський графік не відображає.`
    : null],
];

/**
 * What would change the picture: levels to watch, used only when a side has
 * too few points of its own to make five sentences. Still numbers from the
 * page, never a target or a forecast.
 */
const BULL_WATCH = [
  ({ m }) => isNum(m.sma50) && m.price < m.sma50
    ? `Закриття знову вище 50-денної середньої (${price(m.sma50)}, на ${pct(gap(m.sma50, m.price), 1)} вище) стане першою ознакою розвороту тренду.`
    : null,
  ({ m }) => isNum(m.sma200) && m.price < m.sma200 && (!isNum(m.sma50) || m.price >= m.sma50)
    ? `Повернення вище 200-денної середньої (${price(m.sma200)}) розверне довгостроковий тренд угору.`
    : null,
  ({ m }) => isNum(m.low52w) && m.low52w > 0 && m.price > m.low52w
    ? `Річний мінімум ${price(m.low52w)} (на ${pct(gap(m.price, m.low52w))} нижче) — рівень, де покупці вже заходили раніше.`
    : null,
  ({ m }) => isNum(m.rsi14) && m.rsi14 >= 40 && m.rsi14 < 45
    ? `RSI ${m.rsi14.toFixed(0)} близько до здорової зони; підйом вище 45 підтвердить повернення імпульсу.`
    : null,
];

const BEAR_WATCH = [
  ({ m }) => isNum(m.sma20) && m.price > m.sma20
    ? `Закриття нижче 20-денної середньої (${price(m.sma20)}, на ${pct(gap(m.price, m.sma20), 1)} нижче) стане першою тріщиною в короткостроковому тренді.`
    : null,
  ({ m }) => isNum(m.sma50) && m.price > m.sma50
    ? `Наступна підтримка — 50-денна середня ${price(m.sma50)}; її втрата поставить під сумнів середньостроковий тренд.`
    : null,
  ({ m }) => isNum(m.atr14) && m.atr14 > 0
    ? `За звичайний день ціна рухається приблизно на ${price(m.atr14)} (ATR), тож стоп-лос, набагато ближчий за це, ймовірно, виб'є звичайний шум.`
    : null,
  ({ m }) => isNum(m.rsi14) && m.rsi14 > 65 && m.rsi14 <= 70
    ? `RSI ${m.rsi14.toFixed(0)} наближається до перекупленості, тож найлегша частина руху, можливо, вже позаду.`
    : null,
];

const MIN_POINTS = 4;

function fill(points, watch, context) {
  if (points.length >= MIN_POINTS) return points;
  const extra = watch.map((rule) => rule(context)).filter(Boolean).map((text) => ({ weight: 0, text }));
  return [...points, ...extra.slice(0, MIN_POINTS - points.length)];
}

function collect(rules, context) {
  return rules
    .map(([weight, rule], order) => ({ weight, order, text: rule(context) }))
    .filter((point) => point.text)
    .sort((a, b) => b.weight - a.weight || a.order - b.order);
}

function verdict(side, points, other, score) {
  const strength = points.reduce((sum, p) => sum + p.weight, 0);
  const against = other.reduce((sum, p) => sum + p.weight, 0);
  const label = `Snake Score ${score.total}/100 (${score.label})`;
  if (side === 'bull') {
    if (!points.length) return `${label}: зараз у даних немає аргументів на користь купівлі.`;
    if (strength >= against * 1.5) return `${label}: дані явно на боці покупців.`;
    if (strength > against) return `${label}: у покупців невелика перевага, але є і серйозні заперечення.`;
    return `${label}: аргументи за купівлю є, але сьогодні вони слабші.`;
  }
  if (!points.length) return 'Зараз у даних немає сильних аргументів проти; головний ризик — сам ринок.';
  if (strength >= against * 1.5) return 'Сьогодні аргументи проти сильніші.';
  if (strength > against) return 'У продавців невелика перевага, хоча картина неоднозначна.';
  return 'Аргументи проти слабші, але ці ризики реальні.';
}

/**
 * @param {object} row  a scored row from api.js
 * @returns {{ bull: string[], bear: string[], technicalOnly: boolean }}
 */
export function buildOutlook(row) {
  const context = {
    m: row.metrics || {},
    f: row.fundamentals || {},
    security: row.security || null,
  };
  const bull = collect(BULL, context);
  const bear = collect(BEAR, context);

  const bullPoints = fill(bull, BULL_WATCH, context);
  const bearPoints = fill(bear, BEAR_WATCH, context);

  return {
    bull: [verdict('bull', bull, bear, row.score), ...bullPoints.slice(0, MAX_POINTS).map((p) => p.text)],
    bear: [verdict('bear', bear, bull, row.score), ...bearPoints.slice(0, MAX_POINTS).map((p) => p.text)],
    technicalOnly: !row.score?.fundamentalsAvailable,
  };
}
