import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBuiltInCatalog } from '../src/catalog-data.mjs';
import { buildVallejoVarnishPaint, transformVarnish } from '../scripts/vallejo-varnish-transform.mjs';

test('Vallejo brush-on varnishes (3) are in the built-in catalog', async () => {
  const catalog = await loadBuiltInCatalog();
  const varnishes = catalog.paints.filter(
    (p) => p.provider === 'vallejo' && p.usage_roles.includes('technical'),
  );
  assert.equal(varnishes.length, 3);
  assert.deepEqual(
    varnishes.map((p) => p.id).sort(),
    ['vallejo/gloss-varnish', 'vallejo/matt-varnish', 'vallejo/satin-varnish'],
  );
});

test('Satin Varnish is present and resolves to the technical product_format', async () => {
  const catalog = await loadBuiltInCatalog();
  const satin = catalog.paints.find((p) => p.id === 'vallejo/satin-varnish');
  assert.ok(satin, 'vallejo/satin-varnish should exist');
  assert.equal(satin.name, 'Satin Varnish');
  assert.equal(satin.product_format, 'technical');
});

test('every Vallejo varnish resolves a non-null product_format', async () => {
  const catalog = await loadBuiltInCatalog();
  const unresolved = catalog.paints
    .filter(
      (p) =>
        p.provider === 'vallejo' &&
        p.usage_roles.includes('technical') &&
        p.product_format == null,
    )
    .map((p) => p.id);
  assert.deepEqual(unresolved, []);
});

test('buildVallejoVarnishPaint maps a varnish record to the technical role', () => {
  const paint = buildVallejoVarnishPaint({
    name: 'Satin Varnish',
    sku: '62.063',
    hex: '#FFFFFF',
    type: 'varnish',
  });
  assert.equal(paint.id, 'vallejo/satin-varnish');
  assert.equal(paint.provider, 'vallejo');
  assert.deepEqual(paint.usage_roles, ['technical']);
  assert.deepEqual(paint.rgb, { r: 255, g: 255, b: 255 });
});

test('buildVallejoVarnishPaint rejects a non-varnish record', () => {
  assert.throws(
    () => buildVallejoVarnishPaint({ name: 'White', sku: '62.001', hex: '#FFFFFF', type: 'opaque' }),
    /expected type "varnish"/,
  );
});

test('transformVarnish disambiguates a name that collides with an existing id', () => {
  const paints = transformVarnish(
    [{ name: 'Gloss Varnish', sku: '62.064', hex: '#FFFFFF', type: 'varnish' }],
    new Set(['vallejo/gloss-varnish']),
  );
  assert.equal(paints[0].id, 'vallejo/gloss-varnish-62-064');
  assert.deepEqual(paints[0].usage_roles, ['technical']);
});
