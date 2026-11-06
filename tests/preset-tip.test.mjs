/**
 * Snake Eye — the Ukrainian hover text of the saved strategies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describeCriteria, presetTip } from '../js/preset-tip.js';

const presets = JSON.parse(readFileSync(new URL('../data/presets.json', import.meta.url))).presets;

test('every saved strategy has a Ukrainian summary and a condition list', () => {
  for (const preset of presets) {
    assert.ok(preset.tipUk, `${preset.id} has no tipUk`);
    assert.match(presetTip(preset), /Умови: .+\.$|Умови: .+\. Тікери без/, preset.id);
  }
});

test('ranges read as one phrase and amounts are spelled out', () => {
  const snake = presets.find((p) => p.id === 'snake-hunt');
  const phrases = describeCriteria(snake.criteria);
  assert.ok(phrases.includes('ціна від $2 до $30'));
  assert.ok(phrases.includes('RSI від 40 до 70'));
  assert.ok(phrases.includes('середній обсяг за 20 днів ≥ 500 тис. акцій'));
  assert.ok(phrases.includes('ціна вище SMA50'));
  assert.equal(phrases.filter((p) => p.startsWith('ціна від')).length, 1);
});

test('every criterion of every strategy is described, none in English', () => {
  for (const preset of presets) {
    const phrases = describeCriteria(preset.criteria);
    assert.equal(
      phrases.length,
      Object.keys(preset.criteria).length
        - ('priceMin' in preset.criteria && 'priceMax' in preset.criteria ? 1 : 0)
        - ('rsiMin' in preset.criteria && 'rsiMax' in preset.criteria ? 1 : 0),
      preset.id,
    );
    for (const phrase of phrases) assert.doesNotMatch(phrase, /^(Min|Max|Within) /, `${preset.id}: ${phrase}`);
  }
});

test('a strategy that needs fundamentals says so', () => {
  assert.match(presetTip(presets.find((p) => p.id === 'value')), /без фундаментальних даних/);
  assert.doesNotMatch(presetTip(presets.find((p) => p.id === 'high-volume')), /фундаментальних/);
});
