import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { loadBuiltInCatalog } from '../src/catalog-data.mjs';
import { buildTonePaint, transformTonePro } from '../scripts/tone-pro-transform.mjs';

const SOURCE = JSON.parse(
  await fs.readFile(new URL('../scripts/warhammer-tone-pro.source.json', import.meta.url), 'utf8'),
);

test('pinned source holds 30 families x 5 tones', () => {
  assert.equal(SOURCE.families.length, 30);
  for (const family of SOURCE.families) assert.equal(family.tones.length, 5, family.name);
});

test('all 150 Tone Pro paints are in the built-in citadel catalog as opaque layers', async () => {
  const catalog = await loadBuiltInCatalog();
  const ids = new Set(catalog.paints.map((p) => p.id));
  const expected = transformTonePro(SOURCE.families);
  assert.equal(expected.length, 150);
  for (const paint of expected) assert.ok(ids.has(paint.id), `missing ${paint.id}`);

  const ultramar3 = catalog.paints.find((p) => p.id === 'citadel/ultramar-blue-3');
  assert.equal(ultramar3.name, 'Ultramar Blue 3');
  assert.equal(ultramar3.product_format, 'opaque_layer');
  assert.deepEqual(ultramar3.rgb, { r: 13, g: 79, b: 136 }); // #0D4F88
});

test('buildTonePaint names the paint as the pot label and keeps a Tone Pro alias', () => {
  const paint = buildTonePaint('Megaboss Yellow', 1, '#F9AD00');
  assert.equal(paint.id, 'citadel/megaboss-yellow-1');
  assert.equal(paint.name, 'Megaboss Yellow 1');
  assert.equal(paint.normalized_name, 'megaboss yellow 1');
  assert.deepEqual(paint.aliases, ['Tone Pro Megaboss Yellow 1']);
  assert.deepEqual(paint.usage_roles, ['layer']);
  assert.equal(paint.owned, false);
});

test('a family name with an apostrophe also gets an apostrophe-free alias', () => {
  const paint = buildTonePaint('Ta’unar Ochre', 3, '#E78344');
  assert.deepEqual(paint.aliases, ['Tone Pro Ta’unar Ochre 3', 'Taunar Ochre 3']);
});

test('transformTonePro rejects a family without exactly five tones', () => {
  assert.throws(() => transformTonePro([{ name: 'Short', tones: ['#000000'] }]), /expected 5 tones/);
});

test('transformTonePro fails loudly on an id collision instead of suffixing', () => {
  const family = { name: 'Gnarlwood', tones: ['#342928', '#514235', '#725C44', '#776857', '#887B67'] };
  assert.throws(() => transformTonePro([family], new Set(['citadel/gnarlwood-3'])), /id collision/);
});
