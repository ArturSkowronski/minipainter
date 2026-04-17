import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeRole, rolesMatch } from '../src/roles.mjs';

test('normalizeRole maps shade and contrast to wash', () => {
  assert.equal(normalizeRole('shade'), 'wash');
  assert.equal(normalizeRole('contrast'), 'wash');
});

test('normalizeRole passes through other roles', () => {
  assert.equal(normalizeRole('base'), 'base');
  assert.equal(normalizeRole('layer'), 'layer');
  assert.equal(normalizeRole('metallic'), 'metallic');
});

test('normalizeRole handles unknown or empty input', () => {
  assert.equal(normalizeRole(''), '');
  assert.equal(normalizeRole('unknown'), 'unknown');
});

test('rolesMatch treats shade and contrast as equivalent', () => {
  assert.equal(rolesMatch('shade', 'contrast'), true);
  assert.equal(rolesMatch('contrast', 'shade'), true);
  assert.equal(rolesMatch('shade', 'shade'), true);
});

test('rolesMatch rejects differing role families', () => {
  assert.equal(rolesMatch('base', 'shade'), false);
  assert.equal(rolesMatch('layer', 'metallic'), false);
});
