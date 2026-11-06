/**
 * Snake Eye — what kind of security a row is: an ordinary stock, an ADR, a
 * fund — and which industry it belongs to.
 *
 * The SEC profile (`npm run fundamentals` writes it) is the source of truth.
 * Before that has run, the IBKR company name is the only clue: the gateway
 * labels depositary receipts "ADR" in the name, and most funds carry "FUND" or
 * "ETF" in theirs. "TRUST" is deliberately not a clue — REITs use it too.
 */

const KINDS = {
  fund: {
    label: 'Fund',
    tip:
      'Investment fund: it files N-CSR with the SEC, not a 10-K. Its price can sit at a premium or a discount to the ' +
      'net asset value of what it holds, which these charts do not show, and it has no company fundamentals to score.',
  },
  adr: {
    label: 'ADR',
    tip:
      'Foreign company (files a 20-F with the SEC). The US listing is a depositary receipt for shares traded abroad, so ' +
      'the currency and the home market add risk, and US-GAAP fundamentals are often missing.',
  },
  foreign: {
    label: 'Foreign',
    tip:
      'Foreign issuer filing a 40-F — usually Canadian. Its shares trade both at home and in the US, and its reports ' +
      'follow its home rules, so some fundamentals may be missing.',
  },
};

const ADR_NAME = /\b(ADR|ADS|SPONSORED|DEPOSITARY)\b/i;
const FUND_NAME = /\b(FUND|FD|ETF)\b/i;

/** Kind from the raw IBKR name, before api.js strips the "(ADR)" suffix. */
function kindFromName(name) {
  if (typeof name !== 'string') return 'stock';
  if (ADR_NAME.test(name)) return 'adr';
  if (FUND_NAME.test(name)) return 'fund';
  return 'stock';
}

/**
 * @param {object} stock  a record from the data file
 * @returns {{ kind: string, label: string|null, tip: string|null, industry: string|null,
 *            sector: string|null, country: string|null, source: string }}
 */
export function classifySecurity(stock) {
  const profile = stock.profile || null;
  const kind = profile?.kind || kindFromName(stock.name);
  const meta = KINDS[kind] || null;

  return {
    kind,
    label: meta?.label || null,
    tip: meta?.tip || null,
    industry: profile?.industry || stock.fundamentals?.industry || null,
    sector: stock.sector || null,
    country: profile?.country || null,
    source: profile ? 'SEC EDGAR' : 'name',
  };
}
