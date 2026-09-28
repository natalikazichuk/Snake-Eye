/**
 * Snake Eye — the shared single-symbol path.
 *
 * The network half needs a gateway; these cover the half that does not — what
 * counts as a ticker, and what merging one into the data file does to the rest
 * of it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeIntoFile, normalizeSymbol, removeFromFile } from '../scripts/lib/pull-symbol.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const stock = (ticker, first, last) => ({
  ticker,
  name: `${ticker} CORP`,
  exchange: 'NYSE',
  fundamentals: {},
  history: { dates: [first, last], open: [1, 2], high: [1, 2], low: [1, 2], close: [1, 2], volume: [10, 20] },
});

async function withTempFile(run) {
  const dir = await mkdtemp(join(tmpdir(), 'snake-eye-'));
  const file = join(dir, 'stocks.json');
  try {
    await run(relative(ROOT, file), file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a ticker is letters and dots, up to six', () => {
  assert.equal(normalizeSymbol('plug'), 'PLUG');
  assert.equal(normalizeSymbol('  smc  '), 'SMC');
  assert.equal(normalizeSymbol('BRK.B'), 'BRK.B');

  // The API takes this straight from a request body, so anything that is not a
  // ticker has to come back null rather than reach a URL.
  assert.equal(normalizeSymbol('../etc/passwd'), null);
  assert.equal(normalizeSymbol('TOOLONGSYM'), null);
  assert.equal(normalizeSymbol(''), null);
  assert.equal(normalizeSymbol(null), null);
  assert.equal(normalizeSymbol('A B'), null);
  assert.equal(normalizeSymbol('.AB'), null, 'a leading dot is not a ticker');
});

test('merging creates the file when there is none', async () => {
  await withTempFile(async (rel, abs) => {
    const { total, replaced } = await mergeIntoFile(stock('PLUG', '2026-01-02', '2026-09-18'), { file: rel });
    assert.equal(total, 1);
    assert.equal(replaced, false);

    const payload = JSON.parse(await readFile(abs, 'utf8'));
    assert.equal(payload.stocks[0].ticker, 'PLUG');
    assert.equal(payload.meta.provider, 'IBKR');
    assert.equal(payload.meta.synthetic, false);
    assert.equal(payload.meta.lastSession, '2026-09-18');
  });
});

test('merging an existing symbol replaces it rather than duplicating', async () => {
  await withTempFile(async (rel, abs) => {
    await mergeIntoFile(stock('PLUG', '2026-01-02', '2026-09-11'), { file: rel });
    const { total, replaced } = await mergeIntoFile(stock('PLUG', '2026-01-02', '2026-09-18'), { file: rel });

    assert.equal(total, 1);
    assert.equal(replaced, true);
    const payload = JSON.parse(await readFile(abs, 'utf8'));
    assert.equal(payload.stocks.length, 1);
    assert.equal(payload.stocks[0].history.dates.at(-1), '2026-09-18');
  });
});

test('the session range spans every symbol, not just the newest one', async () => {
  await withTempFile(async (rel, abs) => {
    await mergeIntoFile(stock('AAA', '2025-06-02', '2026-09-18'), { file: rel });
    await mergeIntoFile(stock('BBB', '2026-01-05', '2026-09-11'), { file: rel });

    const payload = JSON.parse(await readFile(abs, 'utf8'));
    assert.equal(payload.meta.firstSession, '2025-06-02');
    assert.equal(payload.meta.lastSession, '2026-09-18', 'the newest last session wins');
  });
});

test('removing a symbol leaves the rest and re-dates the file', async () => {
  await withTempFile(async (rel, abs) => {
    await mergeIntoFile(stock('AAA', '2026-01-02', '2026-09-18'), { file: rel });
    await mergeIntoFile(stock('BBB', '2026-01-02', '2026-09-11'), { file: rel });

    const { total, removed } = await removeFromFile('AAA', { file: rel });
    assert.equal(removed, true);
    assert.equal(total, 1);

    const payload = JSON.parse(await readFile(abs, 'utf8'));
    assert.deepEqual(payload.stocks.map((s) => s.ticker), ['BBB']);
    assert.equal(payload.meta.lastSession, '2026-09-11', 'the range follows what is left');
  });
});

test('removing something that is not there changes nothing', async () => {
  await withTempFile(async (rel, abs) => {
    await mergeIntoFile(stock('AAA', '2026-01-02', '2026-09-18'), { file: rel });
    const before = await readFile(abs, 'utf8');

    const { removed } = await removeFromFile('ZZZ', { file: rel });
    assert.equal(removed, false);
    assert.equal(await readFile(abs, 'utf8'), before);
  });
});

test('a corrupt data file is replaced rather than crashing the pull', async () => {
  await withTempFile(async (rel, abs) => {
    await writeFile(abs, 'not json at all');
    const { total } = await mergeIntoFile(stock('PLUG', '2026-01-02', '2026-09-18'), { file: rel });
    assert.equal(total, 1);
  });
});
