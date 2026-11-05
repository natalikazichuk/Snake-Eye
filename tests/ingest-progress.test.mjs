/**
 * Snake Eye — resumable ingest progress file.
 *
 * Uses a temporary directory; no gateway involved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearProgress,
  loadProgress,
  progressPath,
  saveProgress,
  settledSymbols,
} from '../scripts/lib/ingest-progress.mjs';

const RUN = { period: '3y', bar: '1d', volumeFactor: 100 };
const stock = (ticker) => ({ ticker, history: { dates: ['2026-11-04'], close: [1], high: [1], low: [1], volume: [1] } });

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'snake-progress-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('the progress file sits beside the output', () => {
  assert.equal(progressPath('data/stocks.local.json'), 'data/stocks.local.partial.json');
  assert.equal(progressPath('out'), 'out.partial.json');
});

test('saves and resumes a run with the same settings', () => withDir(async (dir) => {
  const path = join(dir, 'p.json');
  await saveProgress(path, { run: { ...RUN, startedAt: 'x' }, stocks: [stock('AA'), stock('ABEV')], skipped: [['AAC', 'only 30 bars']] });

  const { state, reason } = await loadProgress(path, RUN);
  assert.equal(reason, null);
  assert.deepEqual(state.stocks.map((s) => s.ticker), ['AA', 'ABEV']);
  assert.deepEqual([...settledSymbols(state)].sort(), ['AA', 'AAC', 'ABEV']);
  assert.ok(state.run.updatedAt, 'stamps the save time');

  // No temporary file is left behind after a save.
  await assert.rejects(access(`${path}.tmp`));
}));

test('a run with different settings starts over instead of mixing histories', () => withDir(async (dir) => {
  const path = join(dir, 'p.json');
  await saveProgress(path, { run: { ...RUN, period: '1y' }, stocks: [stock('AA')], skipped: [] });

  const { state, reason } = await loadProgress(path, RUN);
  assert.equal(state, null);
  assert.match(reason, /--period 1y/);
}));

test('no progress file is a fresh start, a broken one is reported', () => withDir(async (dir) => {
  assert.deepEqual(await loadProgress(join(dir, 'missing.json'), RUN), { state: null, reason: null });

  const broken = join(dir, 'broken.json');
  await writeFile(broken, '{"run":{"period":"3y"},"stocks":[{"tick');
  const { state, reason } = await loadProgress(broken, RUN);
  assert.equal(state, null);
  assert.match(reason, /unreadable progress file/);
}));

test('clearing removes the file and any leftover temporary', () => withDir(async (dir) => {
  const path = join(dir, 'p.json');
  await saveProgress(path, { run: RUN, stocks: [], skipped: [] });
  await writeFile(`${path}.tmp`, 'half');
  await clearProgress(path);
  await assert.rejects(readFile(path));
  await assert.rejects(readFile(`${path}.tmp`));
  await clearProgress(path); // and is happy to find nothing
}));
