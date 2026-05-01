import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOverlay,
  resolveProductFormat,
  enrichPaint,
} from '../src/overrides.mjs';

function makeOverlay() {
  return buildOverlay({
    rules: [
      { match: { provider: 'citadel', usage_role: 'shade' }, format: 'wash' },
      { match: { provider: 'citadel', usage_role: 'contrast' }, format: 'contrast' },
      { match: { provider: 'army_painter', usage_role: 'speedpaint' }, format: 'contrast' },
      { match: { provider: 'army_painter', usage_role: 'layer' }, format: 'opaque_layer' },
    ],
    overrides: {
      'army_painter/grim-black': { format: 'contrast', note: 'Speedpaint 2.0' },
    },
  });
}

test('rule resolves citadel shade to wash', () => {
  const overlay = makeOverlay();
  const paint = { id: 'citadel/nuln-oil', provider: 'citadel', usage_roles: ['shade'] };

  assert.equal(resolveProductFormat(paint, overlay).format, 'wash');
});

test('rule resolves citadel contrast to contrast', () => {
  const overlay = makeOverlay();
  const paint = { id: 'citadel/black-templar', provider: 'citadel', usage_roles: ['contrast'] };

  assert.equal(resolveProductFormat(paint, overlay).format, 'contrast');
});

test('rule resolves AP speedpaint role to contrast format', () => {
  const overlay = makeOverlay();
  const paint = { id: 'army_painter/zealot-yellow', provider: 'army_painter', usage_roles: ['speedpaint'] };

  assert.equal(resolveProductFormat(paint, overlay).format, 'contrast');
});

test('per-id override beats matching rule', () => {
  const overlay = makeOverlay();
  const paint = { id: 'army_painter/grim-black', provider: 'army_painter', usage_roles: ['layer'] };

  const resolution = resolveProductFormat(paint, overlay);

  assert.equal(resolution.format, 'contrast');
  assert.equal(resolution.source, 'override');
});

test('unmatched paint reports unresolved with reason', () => {
  const overlay = makeOverlay();
  const paint = { id: 'army_painter/mystery', provider: 'army_painter', usage_roles: ['unknown_role'] };

  const resolution = resolveProductFormat(paint, overlay);

  assert.equal(resolution.format, null);
  assert.equal(resolution.source, 'unresolved');
});

test('first matching rule wins', () => {
  const overlay = buildOverlay({
    rules: [
      { match: { provider: 'army_painter', usage_role: 'layer' }, format: 'opaque_layer' },
      { match: { provider: 'army_painter', usage_role: 'layer' }, format: 'contrast' },
    ],
    overrides: {},
  });
  const paint = { id: 'army_painter/foo', provider: 'army_painter', usage_roles: ['layer'] };

  assert.equal(resolveProductFormat(paint, overlay).format, 'opaque_layer');
});

test('enrichPaint adds product_format without mutating input', () => {
  const overlay = makeOverlay();
  const paint = Object.freeze({
    id: 'citadel/nuln-oil',
    provider: 'citadel',
    usage_roles: Object.freeze(['shade']),
  });

  const enriched = enrichPaint(paint, overlay);

  assert.equal(enriched.product_format, 'wash');
  assert.notEqual(enriched, paint);
});

test('enrichPaint sets product_format to null when unresolved', () => {
  const overlay = makeOverlay();
  const paint = { id: 'army_painter/mystery', provider: 'army_painter', usage_roles: ['unknown_role'] };

  const enriched = enrichPaint(paint, overlay);

  assert.equal(enriched.product_format, null);
});

test('rule matches when paint has multiple usage_roles and any matches', () => {
  const overlay = makeOverlay();
  const paint = {
    id: 'citadel/multi',
    provider: 'citadel',
    usage_roles: ['layer', 'shade'],
  };

  assert.equal(resolveProductFormat(paint, overlay).format, 'wash');
});

test('buildOverlay rejects unknown format values', () => {
  assert.throws(
    () => buildOverlay({
      rules: [{ match: { provider: 'citadel', usage_role: 'shade' }, format: 'not_a_format' }],
      overrides: {},
    }),
    /unknown format/i,
  );
});

test('buildOverlay rejects override with unknown format value', () => {
  assert.throws(
    () => buildOverlay({
      rules: [],
      overrides: { 'foo/bar': { format: 'fake' } },
    }),
    /unknown format/i,
  );
});
