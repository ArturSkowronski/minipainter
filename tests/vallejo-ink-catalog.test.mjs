import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBuiltInCatalog } from '../src/catalog-data.mjs';
import { isInk } from '../src/paint-format.mjs';
import { buildVallejoInkPaint, transformInks } from '../scripts/vallejo-inks-transform.mjs';

test('Vallejo Game Color Ink range (12 inks) is in the built-in catalog', async () => {
  const catalog = await loadBuiltInCatalog();
  const inks = catalog.paints.filter((p) => p.provider === 'vallejo' && p.usage_roles.includes('ink'));
  assert.equal(inks.length, 12);
});

test('Green Ink is present and resolves to the ink product_format', async () => {
  const catalog = await loadBuiltInCatalog();
  const greenInk = catalog.paints.find((p) => p.id === 'vallejo/green-ink');
  assert.ok(greenInk, 'vallejo/green-ink should exist');
  assert.equal(greenInk.name, 'Green Ink');
  assert.equal(greenInk.product_format, 'ink');
  assert.ok(isInk(greenInk));
  assert.deepEqual(greenInk.rgb, { r: 0, g: 112, b: 51 }); // #007033, SKU 72.089
});

test('every Game Ink resolves a non-null product_format', async () => {
  const catalog = await loadBuiltInCatalog();
  const unresolved = catalog.paints
    .filter((p) => p.provider === 'vallejo' && p.usage_roles.includes('ink') && p.product_format == null)
    .map((p) => p.id);
  assert.deepEqual(unresolved, []);
});

test('buildVallejoInkPaint derives the ink role and colour family from the source record', () => {
  const paint = buildVallejoInkPaint({ name: 'Green Ink', sku: '72.089', hex: '#007033' }, new Set());
  assert.equal(paint.id, 'vallejo/green-ink');
  assert.equal(paint.provider, 'vallejo');
  assert.deepEqual(paint.usage_roles, ['ink']);
  assert.deepEqual(paint.color_families, ['green']);
  assert.equal(paint.owned, false);
});

test('transformInks disambiguates a name that collides with an existing id', () => {
  const records = [{ name: 'Green Ink', sku: '72.089', hex: '#007033' }];
  const paints = transformInks(records, new Set(['vallejo/green-ink']));
  assert.equal(paints[0].id, 'vallejo/green-ink-72-089');
  assert.deepEqual(paints[0].usage_roles, ['ink']);
});

test('source aliases are carried onto the paint', () => {
  const paint = buildVallejoInkPaint(
    { name: 'Skin Wash', sku: '72.093', hex: '#C56F18', aliases: ['Skin Ink'] },
    new Set(),
  );
  assert.deepEqual(paint.aliases, ['Skin Ink']);
});
