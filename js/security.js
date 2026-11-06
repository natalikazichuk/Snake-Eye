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
      'Інвестиційний фонд: звітує в SEC формою N-CSR, а не 10-K. Його ціна може бути вищою або нижчою за чисту ' +
      'вартість активів (NAV), чого ці графіки не показують, і в нього немає фундаментальних даних компанії для оцінки.',
  },
  adr: {
    label: 'ADR',
    tip:
      'Іноземна компанія (звітує в SEC формою 20-F). У США торгується депозитарна розписка на акції, що обертаються ' +
      'за кордоном, тож валюта й домашній ринок додають ризику, а фундаментальних даних за US-GAAP часто немає.',
  },
  foreign: {
    label: 'Foreign',
    tip:
      'Іноземний емітент, що звітує формою 40-F, — зазвичай канадський. Його акції торгуються і вдома, і в США, а звіти ' +
      'складені за правилами його країни, тож частини фундаментальних даних може не бути.',
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
