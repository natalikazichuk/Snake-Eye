/**
 * Snake Eye — synthetic market data generator.
 *
 * Builds `data/stocks.json`: a deterministic, completely fictional universe of
 * NYSE/NASDAQ-style tickers with ~220 daily bars each plus fundamentals.
 *
 * The tickers and companies do not exist. The MVP runs on this file so the
 * scanner, indicators and Snake Score can be developed before a real market
 * data provider is wired in (see docs/API.md).
 *
 * Usage: node scripts/generate-stocks.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BARS = 220;
const LAST_SESSION = '2026-09-15';
const SEED = 0x5eede1e;

/** Deterministic PRNG so regenerating the file produces the same universe. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(SEED);
const between = (min, max) => min + rnd() * (max - min);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const round = (value, digits = 2) => Number(value.toFixed(digits));

/** Box-Muller, for price noise that looks like a market instead of a sawtooth. */
function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Walk back `count` business days from `endDate` (ISO) and return the first one. */
function firstSessionDate(endDate, count) {
  const date = new Date(`${endDate}T00:00:00Z`);
  let remaining = count - 1;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

const SECTORS = [
  'Technology', 'Healthcare', 'Energy', 'Financials', 'Industrials',
  'Consumer', 'Materials', 'Utilities', 'Real Estate', 'Communications',
];

/**
 * Fictional universe. Every ticker below is invented: nothing here maps to a
 * real listed company, on purpose.
 */
const UNIVERSE = [
  ['ABC', 'Aurora Biocentric Corp', 'Healthcare'],
  ['XYZ', 'Xenolith Systems', 'Technology'],
  ['QWE', 'Quarry West Energy', 'Energy'],
  ['VPRA', 'Viperra Robotics', 'Technology'],
  ['CBRA', 'Cobra Logistics Group', 'Industrials'],
  ['MMBA', 'Mamba Semiconductor', 'Technology'],
  ['PYTH', 'Python Data Works', 'Technology'],
  ['ADDR', 'Adder Pharmaceuticals', 'Healthcare'],
  ['BOAX', 'Boa Exploration', 'Energy'],
  ['KRAI', 'Krait Analytics', 'Technology'],
  ['SLTH', 'Slither Mobility', 'Consumer'],
  ['FNGR', 'Fang Resources', 'Materials'],
  ['SCAL', 'Scale Industries', 'Industrials'],
  ['VENM', 'Venom Therapeutics', 'Healthcare'],
  ['RTTL', 'Rattle Networks', 'Communications'],
  ['COIL', 'Coil Power & Light', 'Utilities'],
  ['HSSS', 'Hiss Audio Labs', 'Consumer'],
  ['SHED', 'Shedworks Realty', 'Real Estate'],
  ['MOLT', 'Molten Metals', 'Materials'],
  ['BASK', 'Basking Capital', 'Financials'],
  ['NEST', 'Nestwood Homes', 'Real Estate'],
  ['GLDE', 'Glide Freight', 'Industrials'],
  ['CNST', 'Constrictor Steel', 'Materials'],
  ['TAIP', 'Taipan Financial', 'Financials'],
  ['ANCD', 'Anaconda Mining', 'Materials'],
  ['SIDE', 'Sidewinder Motors', 'Consumer'],
  ['ASPD', 'Aspid Health', 'Healthcare'],
  ['ELPS', 'Ellipse Software', 'Technology'],
  ['SPNE', 'Serpentine Energy', 'Energy'],
  ['CORA', 'Coral Snake Foods', 'Consumer'],
  ['TZLA', 'Tesselate Labs', 'Technology'],
  ['NDRA', 'Nadria Medical', 'Healthcare'],
  ['ORYX', 'Oryx Telecom', 'Communications'],
  ['PLTC', 'Pallas Technologies', 'Technology'],
  ['HYDR', 'Hydra Hydrogen', 'Energy'],
  ['BLTA', 'Bolt Aviation', 'Industrials'],
  ['SKAL', 'Skald Media', 'Communications'],
  ['WYRM', 'Wyrm Defense', 'Industrials'],
  ['TTHE', 'Tethe Insurance', 'Financials'],
  ['GRTO', 'Grotto Storage', 'Real Estate'],
  ['LMNA', 'Lamina Materials', 'Materials'],
  ['ZPHR', 'Zephyr Utilities', 'Utilities'],
  ['ECDY', 'Ecdysis Bio', 'Healthcare'],
  ['MSKA', 'Muskoka Retail', 'Consumer'],
  ['FORK', 'Forked Tongue Media', 'Communications'],
  ['DENS', 'Denspark Grid', 'Utilities'],
  ['SCUT', 'Scute Armor Systems', 'Industrials'],
  ['KEEL', 'Keelback Shipping', 'Industrials'],
  ['TRPN', 'Terpene Chemicals', 'Materials'],
  ['MORF', 'Morphic Cloud', 'Technology'],
  ['GRVL', 'Gravel Bay Bancorp', 'Financials'],
  ['NOCT', 'Noctis Optics', 'Technology'],
  ['PITV', 'Pit Viper Outdoors', 'Consumer'],
  ['RCKL', 'Rockledge Energy', 'Energy'],
  ['SWFT', 'Swiftscale Cloud', 'Technology'],
  ['TNDR', 'Tundra Foods', 'Consumer'],
  ['VRDN', 'Verdant Agritech', 'Materials'],
  ['WNDR', 'Wander Travel Group', 'Consumer'],
  ['XLTH', 'Xolith Robotics', 'Technology'],
  ['YRNA', 'Yarrina Pharma', 'Healthcare'],
  ['ZNTH', 'Zenith Rail', 'Industrials'],
  ['AMPH', 'Amphis Energy Storage', 'Energy'],
  ['BRSK', 'Brisk Payments', 'Financials'],
  ['CLDR', 'Caldera Minerals', 'Materials'],
  ['DRFT', 'Driftline Telecom', 'Communications'],
  ['EMBR', 'Ember Grid Solutions', 'Utilities'],
  ['FLKE', 'Flake Semiconductors', 'Technology'],
  ['GSTR', 'Gaststar Hospitality', 'Consumer'],
  ['HLIX', 'Helix Genomics', 'Healthcare'],
  ['IRON', 'Ironscale Foundry', 'Materials'],
  ['JVLN', 'Javelin Aerospace', 'Industrials'],
  ['KTNA', 'Katana Cyber', 'Technology'],
];

/**
 * Price path: geometric random walk with a per-ticker drift plus a slow
 * regime wave, so the universe contains real uptrends, downtrends and ranges
 * rather than uniform noise.
 */
function buildHistory(profile) {
  const { startPrice, drift, volatility, baseVolume } = profile;
  const wavePeriod = between(45, 130);
  const wavePhase = between(0, Math.PI * 2);
  const waveAmplitude = between(0.0004, 0.0035);

  // Roughly a third of the universe gets a recent catalyst: a short burst of
  // elevated volume on the newest bars, so relative-volume filters and the
  // breakout preset have something to find in the demo universe.
  const surgeDays = rnd() < 0.34 ? Math.ceil(between(1, 3)) : 0;
  const surgeFactor = between(1.7, 3.9);

  const close = [];
  const high = [];
  const low = [];
  const volume = [];

  let price = startPrice;
  for (let i = 0; i < BARS; i += 1) {
    const wave = Math.sin(wavePhase + (i / wavePeriod) * Math.PI * 2) * waveAmplitude;
    const shock = rnd() < 0.015 ? gauss() * volatility * 4 : 0;
    const catalyst = surgeDays > 0 && i >= BARS - surgeDays ? volatility * between(0.4, 2.2) : 0;
    const change = drift + wave + gauss() * volatility + shock + catalyst;
    price = Math.max(0.35, price * (1 + change));

    const range = price * Math.max(0.004, Math.abs(gauss()) * volatility * 1.6);
    const barHigh = price + range * between(0.25, 0.85);
    const barLow = Math.max(0.2, price - range * between(0.25, 0.85));

    // Volume rises with the size of the move, then gets its own noise on top.
    const moveFactor = 1 + Math.min(4, Math.abs(change) / Math.max(volatility, 1e-6)) * 0.35;
    const surging = surgeDays > 0 && i >= BARS - surgeDays;
    const bar = baseVolume * moveFactor * between(0.55, 1.6) * (surging ? surgeFactor : 1);

    close.push(round(price, 2));
    high.push(round(barHigh, 2));
    low.push(round(barLow, 2));
    volume.push(Math.round(bar / 1000) * 1000);
  }

  return { close, high, low, volume };
}

function buildFundamentals(profile, history) {
  const price = history.close.at(-1);
  const sharesOutstanding = Math.round(profile.shares);
  const marketCap = Math.round(price * sharesOutstanding);

  const psRatio = between(0.6, 9.5);
  const revenue = Math.round(marketCap / psRatio);
  const revenueGrowth = round(between(-0.18, 0.55), 4);

  const profitable = rnd() > 0.24;
  const netMargin = profitable ? between(0.02, 0.24) : between(-0.22, -0.01);
  const netIncome = revenue * netMargin;
  const eps = round(netIncome / sharesOutstanding, 2);
  const peRatio = eps > 0 ? round(price / eps, 2) : null;
  const epsGrowth = round(between(-0.4, 0.85), 4);

  const grossMargin = round(between(0.16, 0.74), 4);
  const operatingMargin = round(Math.min(grossMargin - 0.02, netMargin + between(0.01, 0.1)), 4);
  const equity = Math.max(marketCap * between(0.15, 0.7), 1);
  const debtEquity = round(between(0.05, 2.4), 2);
  const roe = round(netIncome / equity, 4);
  const currentRatio = round(between(0.7, 4.2), 2);

  return {
    marketCap,
    sharesOutstanding,
    revenue,
    revenueGrowth,
    eps,
    epsGrowth,
    pe: peRatio,
    ps: round(psRatio, 2),
    roe,
    debtEquity,
    grossMargin,
    operatingMargin,
    currentRatio,
  };
}

const stocks = UNIVERSE.map(([ticker, name, sector]) => {
  const priceTier = rnd();
  let startPrice;
  if (priceTier < 0.2) startPrice = between(1.2, 5);
  else if (priceTier < 0.5) startPrice = between(5, 20);
  else if (priceTier < 0.78) startPrice = between(20, 50);
  else if (priceTier < 0.93) startPrice = between(50, 100);
  else startPrice = between(100, 340);

  const profile = {
    startPrice,
    drift: between(-0.0022, 0.0034),
    volatility: between(0.012, 0.045),
    baseVolume: between(120_000, 14_000_000),
    shares: between(8_000_000, 900_000_000),
  };

  const history = buildHistory(profile);

  return {
    ticker,
    name,
    exchange: rnd() < 0.55 ? 'NASDAQ' : 'NYSE',
    sector: sector || pick(SECTORS),
    currency: 'USD',
    fundamentals: buildFundamentals(profile, history),
    history,
  };
});

const payload = {
  meta: {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/generate-stocks.mjs',
    seed: SEED,
    bars: BARS,
    firstSession: firstSessionDate(LAST_SESSION, BARS),
    lastSession: LAST_SESSION,
    synthetic: true,
    notice:
      'Fictional demo data. Tickers, companies and prices are generated and do not represent any real security.',
  },
  stocks,
};

mkdirSync(resolve(ROOT, 'data'), { recursive: true });
const outFile = resolve(ROOT, 'data/stocks.json');
writeFileSync(outFile, `${JSON.stringify(payload)}\n`);

const sizeKb = (Buffer.byteLength(JSON.stringify(payload)) / 1024).toFixed(0);
console.log(`Wrote ${stocks.length} tickers x ${BARS} bars -> data/stocks.json (${sizeKb} KB)`);
