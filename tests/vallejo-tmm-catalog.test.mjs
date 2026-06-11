import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBuiltInCatalog } from '../src/catalog-data.mjs';
import { dedupeBySku, transformTmm } from '../scripts/vallejo-tmm-transform.mjs';

test('Vallejo True Metallic Metal range (20 paints) is in the built-in catalog', async () => {
  const catalog = await loadBuiltInCatalog();
  const tmm = catalog.paints.filter((p) => p.provider === 'vallejo' && p.usage_roles.includes('metallic'));
  assert.equal(tmm.length, 20);
});

test('Imperial Gold is present and resolves to the metallic product_format', async () => {
  const catalog = await loadBuiltInCatalog();
  const imperialGold = catalog.paints.find((p) => p.id === 'vallejo/imperial-gold');
  assert.ok(imperialGold, 'vallejo/imperial-gold should exist');
  assert.equal(imperialGold.name, 'Imperial Gold');
  assert.equal(imperialGold.product_format, 'metallic');
  assert.deepEqual(imperialGold.rgb, { r: 209, g: 169, b: 101 }); // #D1A965, SKU 77.103
});

test('every TMM paint resolves a non-null product_format', async () => {
  const catalog = await loadBuiltInCatalog();
  const unresolved = catalog.paints
    .filter((p) => p.provider === 'vallejo' && p.usage_roles.includes('metallic') && p.product_format == null)
    .map((p) => p.id);
  assert.deepEqual(unresolved, []);
});

test('dedupeBySku keeps the smallest SKU per colour name', () => {
  const records = [
    { name: 'Imperial Gold', sku: '77.143', hex: '#603C1E' },
    { name: 'Imperial Gold', sku: '77.103', hex: '#D1A965' },
    { name: 'Imperial Gold', sku: '77.123', hex: '#CB8B50' },
  ];
  const deduped = dedupeBySku(records);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].sku, '77.103');
});

test('transformTmm disambiguates a name that collides with an existing id', () => {
  const records = [{ name: 'Ultramarine Blue', sku: '77.110', hex: '#7EB0CB' }];
  const paints = transformTmm(records, new Set(['vallejo/ultramarine-blue']));
  assert.equal(paints[0].id, 'vallejo/ultramarine-blue-77-110');
  assert.deepEqual(paints[0].usage_roles, ['metallic']);
});
