/**
 * Snake Eye — the NYSE listing, read from Nasdaq Trader's symbol directory.
 *
 * `otherlisted.txt` is the free, public list of every security listed on an
 * exchange other than Nasdaq, refreshed each morning. It names the venue, so
 * NYSE is the rows with Exchange `N`. Nothing here is market data: it is a list
 * of symbols and names, fine to fetch, keep and commit.
 *
 * The file mixes common stock with preferreds, warrants, units, rights and
 * exchange-traded notes. A price scan wants the stock, so the rest is filtered
 * out here, by symbol shape first and security name second.
 *
 * Pure functions only — no network, no files — so the filter can be tested.
 */

export const SYMBOL_DIRECTORY_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';

/** Exchange codes used by the directory. */
export const EXCHANGES = { N: 'NYSE', A: 'NYSE American', P: 'NYSE Arca', Z: 'Cboe BZX', V: 'IEX' };

/**
 * Debt and preferred issues trade under plain-looking symbols (AFGB, BEPH), so
 * the symbol alone does not give them away; their names do — a coupon, "notes
 * due", "debentures", "preferred stock".
 */
const NOT_COMMON = /\d(?:\.\d+)?\s*%|\bnotes?\b|\bdebentures?\b|\bpreferred (?:stock|shares?)\b|\bwarrants?\b|\bcontingent value\b/i;

/** ADRs can mention preferred shares in their name and are still the stock. */
const DEPOSITARY_RECEIPT = /\bamerican depositary\b|\bADRs?\b|\bADS\b/i;

/**
 * Parse the pipe-delimited directory into rows.
 *
 * The last line is a footer ("File Creation Time: …"), not a security, and is
 * returned separately so callers can say how fresh the list is.
 */
export function parseSymbolDirectory(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error('The symbol directory is empty.');

  const header = lines[0].split('|').map((h) => h.trim());
  const col = (name) => header.indexOf(name);
  const idx = {
    symbol: col('ACT Symbol'),
    name: col('Security Name'),
    exchange: col('Exchange'),
    etf: col('ETF'),
    test: col('Test Issue'),
  };
  if (Object.values(idx).some((i) => i < 0)) {
    throw new Error(`Unexpected symbol directory header: ${lines[0].slice(0, 120)}`);
  }

  let created = null;
  const rows = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith('File Creation Time')) {
      created = line.split('|')[0].replace('File Creation Time:', '').trim() || null;
      continue;
    }
    const cells = line.split('|');
    rows.push({
      symbol: (cells[idx.symbol] || '').trim().toUpperCase(),
      name: (cells[idx.name] || '').trim(),
      exchange: (cells[idx.exchange] || '').trim(),
      etf: (cells[idx.etf] || '').trim() === 'Y',
      test: (cells[idx.test] || '').trim() === 'Y',
    });
  }
  return { rows, created };
}

/**
 * Why a row is not an ordinary share, or null when it is one.
 *
 * Class shares (BF.B, AKO.A) are common stock, but the IBKR ingest looks them
 * up as `BF B` and does not resolve the dotted form yet, so they are reported
 * as skipped rather than put on a list the ingest would then fail on.
 */
export function exclusionReason(row) {
  if (row.test) return 'test issue';
  if (row.etf) return 'ETF';
  if (/[$^=+#*]/.test(row.symbol)) return 'preferred or other class';

  const dotted = row.symbol.match(/^[A-Z]{1,5}\.([A-Z]+)$/);
  if (dotted) {
    if (dotted[1] === 'U') return 'unit';
    if (dotted[1] === 'W' || dotted[1] === 'WS') return 'warrant';
    if (dotted[1] === 'R') return 'right';
    return 'class share';
  }
  if (!/^[A-Z]{1,5}$/.test(row.symbol)) return 'unusual symbol';

  if (NOT_COMMON.test(row.name) && !DEPOSITARY_RECEIPT.test(row.name)) return 'debt or preferred';
  return null;
}

/**
 * The common stocks listed on one venue (NYSE by default), plus a tally of
 * what was left out and why.
 */
export function commonStocks(rows, { exchange = 'N' } = {}) {
  const stocks = [];
  const skipped = {};
  for (const row of rows) {
    if (row.exchange !== exchange) continue;
    const reason = exclusionReason(row);
    if (reason) {
      skipped[reason] = (skipped[reason] || 0) + 1;
      continue;
    }
    stocks.push({ symbol: row.symbol, name: row.name });
  }
  return { stocks, skipped };
}

/**
 * A snapshot price from IBKR's last-price field.
 *
 * Field 31 carries a one-letter prefix when the value is not a live trade:
 * `C` for the previous close, `H` for a halted symbol. The number is still the
 * price, so the prefix is dropped rather than the value discarded.
 */
export function parseSnapshotPrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/^[A-Z]/, '').replace(/,/g, '');
  const n = Number(text);
  return text && Number.isFinite(n) && n > 0 ? n : null;
}

/** Keep the symbols whose price falls inside [min, max). */
export function withinPrice(prices, { min = null, max = null } = {}) {
  const kept = [];
  const noPrice = [];
  for (const [symbol, price] of prices) {
    if (price === null || price === undefined) {
      noPrice.push(symbol);
      continue;
    }
    if (min !== null && price < min) continue;
    if (max !== null && price >= max) continue;
    kept.push(symbol);
  }
  return { kept, noPrice };
}
