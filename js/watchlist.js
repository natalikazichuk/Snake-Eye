/**
 * Snake Eye — watchlist.
 *
 * MVP storage is `localStorage`: the list lives in the browser, survives a
 * reload, and needs no account. A Stage 4 backend can swap the two storage
 * functions below for API calls without touching the pages.
 */

const STORAGE_KEY = 'snake-eye:watchlist';
const CHANGE_EVENT = 'snake-eye:watchlist-change';

const listeners = new Set();

function read() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item === 'string').map((item) => item.toUpperCase());
  } catch {
    // Private mode, disabled storage, or corrupted JSON: behave as if empty
    // rather than breaking the page.
    return [];
  }
}

function write(tickers) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tickers));
  } catch {
    /* storage unavailable — the in-memory result of this call still stands */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: tickers }));
  listeners.forEach((listener) => listener(tickers));
}

/** Tickers on the watchlist, most recently added first. */
export function list() {
  return read();
}

export function count() {
  return read().length;
}

export function has(ticker) {
  return read().includes(String(ticker).toUpperCase());
}

export function add(ticker) {
  const symbol = String(ticker).toUpperCase();
  const current = read();
  if (current.includes(symbol)) return current;
  const next = [symbol, ...current];
  write(next);
  return next;
}

export function remove(ticker) {
  const symbol = String(ticker).toUpperCase();
  const next = read().filter((item) => item !== symbol);
  write(next);
  return next;
}

/** Add if missing, remove if present. Returns true when the stock is now saved. */
export function toggle(ticker) {
  const symbol = String(ticker).toUpperCase();
  if (has(symbol)) {
    remove(symbol);
    return false;
  }
  add(symbol);
  return true;
}

export function clear() {
  write([]);
}

/** Subscribe to changes, including edits made in another tab. */
export function subscribe(listener) {
  listeners.add(listener);
  const onStorage = (event) => {
    if (event.key === STORAGE_KEY) listener(read());
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
