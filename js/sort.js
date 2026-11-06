/**
 * Snake Eye — table sorting shared by the scanner and My tickers.
 *
 * Rows with no value for the sorted column always sink to the bottom, in
 * either direction: a symbol without a P/E is not "cheapest" when sorting
 * ascending, and not "most expensive" when sorting descending.
 *
 * Pure — no DOM — so tests/sort.test.mjs can drive it.
 */

const missing = (value) => value === null || value === undefined || Number.isNaN(value);

/**
 * @param {object[]} rows
 * @param {(row: object) => number|string|boolean|null} value
 * @param {'asc'|'desc'} dir
 * @returns {object[]} a new, sorted array; ties keep their original order
 */
export function sortBy(rows, value, dir = 'desc') {
  const factor = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, key: value(row) }))
    .sort((a, b) => {
      const aMissing = missing(a.key);
      const bMissing = missing(b.key);
      if (aMissing || bMissing) return aMissing === bMissing ? a.index - b.index : aMissing ? 1 : -1;
      const order = typeof a.key === 'string'
        ? a.key.localeCompare(b.key)
        : Number(a.key) - Number(b.key);
      return order * factor || a.index - b.index;
    })
    .map((entry) => entry.row);
}
