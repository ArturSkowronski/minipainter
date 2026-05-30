import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBuiltInCatalog } from '../src/catalog-data.mjs';

test('AK Interactive provider is present in the built-in catalog', async () => {
  const catalog = await loadBuiltInCatalog();
  assert.ok(catalog.providers.some((p) => p.id === 'ak_interactive'));
});

test('AK catalog has 613 paints', async () => {
  const catalog = await loadBuiltInCatalog();
  const ak = catalog.paints.filter((p) => p.provider === 'ak_interactive');
  assert.equal(ak.length, 613);
});

test('every AK paint resolves a non-null product_format', async () => {
  const catalog = await loadBuiltInCatalog();
  const unresolved = catalog.paints
    .filter((p) => p.provider === 'ak_interactive' && p.product_format == null)
    .map((p) => p.id);
  assert.deepEqual(unresolved, []);
});

test('every AK paint has valid required fields', async () => {
  const catalog = await loadBuiltInCatalog();
  for (const p of catalog.paints.filter((x) => x.provider === 'ak_interactive')) {
    assert.match(p.id, /^ak_interactive\//);
    assert.ok(p.name && p.normalized_name);
    assert.equal(p.usage_roles.length >= 1, true);
    assert.equal(p.color_families.length >= 1, true);
    assert.ok(Number.isInteger(p.rgb.r) && Number.isInteger(p.rgb.g) && Number.isInteger(p.rgb.b));
  }
});
