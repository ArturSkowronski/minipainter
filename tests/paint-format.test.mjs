import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isOpaque,
  isTransparentOneCoat,
  isWash,
  isMetallic,
  equivalentFormat,
} from '../src/paint-format.mjs';

const opaqueBase = { product_format: 'opaque_base' };
const opaqueLayer = { product_format: 'opaque_layer' };
const wash = { product_format: 'wash' };
const contrast = { product_format: 'contrast' };
const technical = { product_format: 'technical' };
const metallic = { product_format: 'metallic' };
const unresolved = { product_format: null };

test('isOpaque is true for opaque_base and opaque_layer', () => {
  assert.equal(isOpaque(opaqueBase), true);
  assert.equal(isOpaque(opaqueLayer), true);
  assert.equal(isOpaque(metallic), true);
});

test('isOpaque is false for transparent products', () => {
  assert.equal(isOpaque(wash), false);
  assert.equal(isOpaque(contrast), false);
});

test('isTransparentOneCoat is true only for contrast', () => {
  assert.equal(isTransparentOneCoat(contrast), true);
  assert.equal(isTransparentOneCoat(wash), false);
  assert.equal(isTransparentOneCoat(opaqueLayer), false);
});

test('isWash is true only for wash', () => {
  assert.equal(isWash(wash), true);
  assert.equal(isWash(contrast), false);
});

test('isMetallic is true only for metallic', () => {
  assert.equal(isMetallic(metallic), true);
  assert.equal(isMetallic(opaqueBase), false);
});

test('equivalentFormat treats Citadel contrast and AP speedpaint as equivalent', () => {
  const apSpeedpaint = { provider: 'army_painter', product_format: 'contrast' };
  const citadelContrast = { provider: 'citadel', product_format: 'contrast' };

  assert.equal(equivalentFormat(apSpeedpaint, citadelContrast), true);
});

test('equivalentFormat treats Citadel shade and AP wash as equivalent', () => {
  const citShade = { provider: 'citadel', product_format: 'wash' };
  const apWash = { provider: 'army_painter', product_format: 'wash' };

  assert.equal(equivalentFormat(citShade, apWash), true);
});

test('equivalentFormat returns false for shade vs contrast', () => {
  assert.equal(equivalentFormat(wash, contrast), false);
});

test('equivalentFormat returns false for opaque vs transparent', () => {
  assert.equal(equivalentFormat(opaqueLayer, contrast), false);
});

test('predicates return false when product_format is null', () => {
  assert.equal(isOpaque(unresolved), false);
  assert.equal(isTransparentOneCoat(unresolved), false);
  assert.equal(isWash(unresolved), false);
});

test('equivalentFormat returns false when either side is unresolved', () => {
  assert.equal(equivalentFormat(unresolved, contrast), false);
  assert.equal(equivalentFormat(contrast, unresolved), false);
});
