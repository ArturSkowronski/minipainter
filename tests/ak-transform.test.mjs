import test from 'node:test';
import assert from 'node:assert/strict';

import {
  slugify,
  hexToRgb,
  classifyColorFamily,
  buildPaint,
  TYPE_TO_ROLE,
  transformCatalog,
} from '../scripts/ak-transform.mjs';

const SRC = {
  brand: 'AK Interactive',
  name: 'Dark Grey-Blue',
  sku: 'AK11201',
  type: 'opaque',
  hex: '#3B4A5A',
  range: '3rd Generation',
};

test('slugify lowercases and dashes non-alphanumerics', () => {
  assert.equal(slugify('Dark Grey-Blue'), 'dark-grey-blue');
  assert.equal(slugify('  A-18f  Light/Grey '), 'a-18f-light-grey');
});

test('hexToRgb parses #RRGGBB with or without hash', () => {
  assert.deepEqual(hexToRgb('#1A6AB8'), { r: 26, g: 106, b: 184 });
  assert.deepEqual(hexToRgb('FFFFFF'), { r: 255, g: 255, b: 255 });
});

test('hexToRgb throws on invalid input', () => {
  assert.throws(() => hexToRgb('#12'), /invalid hex/i);
  assert.throws(() => hexToRgb(''), /invalid hex/i);
});

test('classifyColorFamily maps achromatic and hue regions', () => {
  assert.equal(classifyColorFamily({ r: 0, g: 0, b: 0 }), 'black');
  assert.equal(classifyColorFamily({ r: 255, g: 255, b: 255 }), 'white');
  assert.equal(classifyColorFamily({ r: 128, g: 128, b: 128 }), 'grey');
  assert.equal(classifyColorFamily({ r: 220, g: 20, b: 20 }), 'red');
  assert.equal(classifyColorFamily({ r: 30, g: 120, b: 220 }), 'blue');
  assert.equal(classifyColorFamily({ r: 230, g: 200, b: 40 }), 'yellow');
  assert.equal(classifyColorFamily({ r: 40, g: 160, b: 60 }), 'green');
  assert.equal(classifyColorFamily({ r: 90, g: 55, b: 25 }), 'brown');
});

test('classifyColorFamily distinguishes light reds (pink) from saturated red', () => {
  assert.equal(classifyColorFamily({ r: 255, g: 192, b: 203 }), 'pink');
  assert.equal(classifyColorFamily({ r: 220, g: 20, b: 20 }), 'red');
});

test('TYPE_TO_ROLE covers every in-scope AK type', () => {
  assert.deepEqual(TYPE_TO_ROLE, {
    opaque: 'base',
    air: 'air',
    metallic: 'metallic',
    technical: 'technical',
    wash: 'shade',
    contrast: 'contrast',
    ink: 'shade',
  });
});

test('buildPaint maps a source record to our schema', () => {
  const paint = buildPaint(SRC, 'ak_interactive/dark-grey-blue');
  assert.deepEqual(paint, {
    id: 'ak_interactive/dark-grey-blue',
    provider: 'ak_interactive',
    name: 'Dark Grey-Blue',
    normalized_name: 'dark grey blue',
    aliases: [],
    usage_roles: ['base'],
    color_families: ['blue'],
    rgb: { r: 59, g: 74, b: 90 },
    owned: false,
  });
});

test('buildPaint uses metallic family for metallic type', () => {
  const paint = buildPaint({ ...SRC, type: 'metallic', hex: '#B0A060' }, 'ak_interactive/x');
  assert.deepEqual(paint.usage_roles, ['metallic']);
  assert.deepEqual(paint.color_families, ['metallic']);
});

test('buildPaint maps ink type to shade role', () => {
  const paint = buildPaint({ ...SRC, type: 'ink' }, 'ak_interactive/y');
  assert.deepEqual(paint.usage_roles, ['shade']);
});

test('buildPaint throws on unknown type', () => {
  assert.throws(() => buildPaint({ ...SRC, type: 'varnish' }, 'ak_interactive/z'), /unknown ak type/i);
});

test('buildPaint throws on missing name or sku', () => {
  assert.throws(() => buildPaint({ ...SRC, name: '' }, 'id'), /missing name/i);
  assert.throws(() => buildPaint({ ...SRC, sku: '' }, 'id'), /missing sku/i);
});

const RECORDS = [
  { name: 'White', sku: 'AK11001', type: 'opaque', hex: '#FFFFFF' },
  { name: 'Black', sku: 'AK11050', type: 'opaque', hex: '#101010' },   // collides
  { name: 'Black', sku: 'AK17000', type: 'ink', hex: '#0A0A0A' },      // collides
  { name: 'Primer Grey', sku: 'AK999', type: 'primer', hex: '#888888' }, // skipped
];

test('transformCatalog skips primers, disambiguates collisions, sorts by id', () => {
  const catalog = transformCatalog(RECORDS);
  assert.deepEqual(catalog.provider, { id: 'ak_interactive', name: 'AK Interactive' });
  const ids = catalog.paints.map((p) => p.id);
  assert.deepEqual(ids, [
    'ak_interactive/black-ak11050',
    'ak_interactive/black-ak17000',
    'ak_interactive/white',
  ]);
  assert.equal(catalog.paints.some((p) => p.name === 'Primer Grey'), false);
});

test('transformCatalog keeps a clean slug when unique', () => {
  const catalog = transformCatalog([{ name: 'Lime Green', sku: 'AK1', type: 'opaque', hex: '#7CB342' }]);
  assert.equal(catalog.paints[0].id, 'ak_interactive/lime-green');
});
