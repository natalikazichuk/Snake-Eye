/**
 * Snake Eye — what kind of security a symbol is, from SEC EDGAR.
 *
 * `data.sec.gov/submissions/CIK##########.json` carries the filer's industry
 * code and the list of forms it files, which says more than any name can:
 *
 *   - a fund files N-CSR / N-CSRS / NPORT-P / N-CEN and never a 10-K,
 *   - a foreign private issuer files a 20-F (or a Canadian 40-F) instead,
 *   - everything else files 10-K and 10-Q.
 *
 * Pure: no network, no I/O, so the rules are testable against saved payloads.
 */

/** Forms only investment companies file. */
const FUND_FORMS = new Set(['N-CSR', 'N-CSRS', 'N-CSR/A', 'NPORT-P', 'N-CEN', 'N-Q', 'N-30D']);

/** The annual report each kind of filer sends, newest-first order decides. */
const ANNUAL = { '10-K': 'stock', '10-K/A': 'stock', '20-F': 'adr', '20-F/A': 'adr', '40-F': 'foreign', '40-F/A': 'foreign' };

/** "SERVICES-PREPACKAGED SOFTWARE" -> "Services-Prepackaged Software". */
export function titleCase(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  return text
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-/&(,])([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase())
    .replace(/\b(Of|And|For|The|In|On|Ex|To)\b/g, (word, _w, offset) => (offset === 0 ? word : word.toLowerCase()));
}

/**
 * @returns {{ kind: 'stock'|'adr'|'foreign'|'fund', industry: string|null,
 *            sic: string|null, country: string|null, source: string } | null}
 */
export function buildProfile(submissions) {
  if (!submissions || typeof submissions !== 'object') return null;

  const forms = submissions.filings?.recent?.form || [];
  const formSet = new Set(forms);

  // `recent` is newest first, so the first annual form is the current regime:
  // Shopify filed 40-F for years and 10-K since, and should read as domestic.
  const latestAnnual = forms.find((form) => ANNUAL[form]);
  const filesFundForms = forms.some((form) => FUND_FORMS.has(form));

  let kind = latestAnnual ? ANNUAL[latestAnnual] : 'stock';
  // A business development company (ARCC) registers on N-2 like a fund but
  // reports on 10-K with real revenue and earnings: it scores as a company.
  if (filesFundForms && !formSet.has('10-K')) kind = 'fund';

  const business = submissions.addresses?.business || {};
  const country = business.isForeignLocation ? (business.country || null) : null;

  let industry = titleCase(submissions.sicDescription);
  if (!industry && kind === 'fund') {
    industry = formSet.has('N-2') || formSet.has('N-CSR') ? 'Closed-end fund' : 'Investment fund';
  }

  return {
    kind,
    industry,
    sic: submissions.sic ? String(submissions.sic) : null,
    country,
    source: 'SEC EDGAR',
  };
}
