/**
 * Snake Eye — resumable ingest.
 *
 * A full NYSE ingest takes hours. Before this, the data file was written only
 * at the very end, so a computer that slept or switched off at symbol 600 lost
 * all 600. Now the ingest keeps a progress file beside the output and saves it
 * every few symbols; running the same command again picks up where it stopped.
 *
 * The progress file is separate from the data file on purpose: the site keeps
 * showing the last complete dataset while a new one is being built, and only a
 * finished run replaces it.
 *
 * What is remembered:
 *   - every stock record already pulled, and
 *   - symbols skipped for a lasting reason (no contract, too little history,
 *     stopped trading), so they are not asked for again.
 * Symbols that failed on an error (a dropped session, a timeout) are not
 * remembered, so the next run retries them.
 */

import { readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/** `data/stocks.local.json` → `data/stocks.local.partial.json`. */
export function progressPath(outPath) {
  return /\.json$/i.test(outPath) ? outPath.replace(/\.json$/i, '.partial.json') : `${outPath}.partial.json`;
}

/**
 * The saved progress, if it belongs to a run with the same settings.
 *
 * A progress file from a run with a different period or bar size would mix one
 * year of history with three, so it is reported and ignored, not merged.
 */
export async function loadProgress(path, { period, bar, volumeFactor }) {
  let saved;
  try {
    saved = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { state: null, reason: null };
    // A file cut off mid-write cannot be trusted; start over rather than guess.
    return { state: null, reason: `unreadable progress file (${error.message}), starting over` };
  }

  const run = saved?.run || {};
  if (!Array.isArray(saved?.stocks)) return { state: null, reason: 'progress file has no stocks, starting over' };
  if (run.period !== period || run.bar !== bar || run.volumeFactor !== volumeFactor) {
    return {
      state: null,
      reason: `progress file is from a run with --period ${run.period} --bar ${run.bar}` +
        `${run.volumeFactor !== volumeFactor ? ` --volume-factor ${run.volumeFactor}` : ''}, starting over`,
    };
  }

  return {
    state: {
      run,
      stocks: saved.stocks,
      skipped: Array.isArray(saved.skipped) ? saved.skipped : [],
    },
    reason: null,
  };
}

/**
 * Write the progress file without ever leaving a half-written one behind:
 * write a temporary file, then rename it over the old one. A power cut during
 * the write loses at most the last few symbols, never the whole file.
 */
export async function saveProgress(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify({ ...state, run: { ...state.run, updatedAt: new Date().toISOString() } })}\n`);
  await rename(temp, path);
}

export async function clearProgress(path) {
  await rm(path, { force: true });
  await rm(`${path}.tmp`, { force: true });
}

/** Which of `symbols` the saved progress already settles, and how. */
export function settledSymbols(state) {
  const done = new Set();
  if (!state) return done;
  for (const stock of state.stocks) done.add(String(stock.ticker).toUpperCase());
  for (const [symbol] of state.skipped) done.add(String(symbol).toUpperCase());
  return done;
}
