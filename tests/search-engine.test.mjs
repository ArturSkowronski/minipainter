import test from 'node:test';
import assert from 'node:assert/strict';

import {
  matchByColor,
  resolvePaint,
  searchPaints,
} from '../src/search-engine.mjs';

function makeRegistry() {
  return {
    version: 1,
    catalog: {
      providers: [
        { id: 'citadel', name: 'Citadel' },
        { id: 'army_painter', name: 'Army Painter' },
      ],
      paints: [
        {
          id: 'citadel/abaddon-black',
          provider: 'citadel',
          name: 'Abaddon Black',
          normalized_name: 'abaddon black',
          aliases: ['black'],
          usage_roles: ['base'],
          color_families: ['black'],
          rgb: { r: 20, g: 20, b: 20 },
          owned: true,
        },
        {
          id: 'army_painter/matt-black',
          provider: 'army_painter',
          name: 'Matt Black',
          normalized_name: 'matt black',
          aliases: ['black'],
          usage_roles: ['base'],
          color_families: ['black'],
          rgb: { r: 26, g: 26, b: 26 },
          owned: false,
        },
        {
          id: 'citadel/leadbelcher',
          provider: 'citadel',
          name: 'Leadbelcher',
          normalized_name: 'leadbelcher',
          aliases: ['silver metallic'],
          usage_roles: ['metallic'],
          color_families: ['steel', 'metallic', 'silver'],
          rgb: { r: 120, g: 124, b: 128 },
          owned: false,
        },
        {
          id: 'army_painter/pallid-bone',
          provider: 'army_painter',
          name: 'Pallid Bone',
          normalized_name: 'pallid bone',
          aliases: ['bone'],
          usage_roles: ['layer'],
          color_families: ['bone'],
          rgb: { r: 209, g: 193, b: 157 },
          owned: true,
        },
      ],
    },
  };
}

test('searchPaints prefers exact name match', () => {
  const results = searchPaints(makeRegistry(), 'Abaddon Black');

  assert.equal(results[0].paint.id, 'citadel/abaddon-black');
});

test('searchPaints matches aliases', () => {
  const results = searchPaints(makeRegistry(), 'silver metallic');

  assert.equal(results[0].paint.id, 'citadel/leadbelcher');
});

test('searchPaints ranks owned paints first for equivalent relevance', () => {
  const results = searchPaints(makeRegistry(), 'black');

  assert.equal(results[0].paint.id, 'citadel/abaddon-black');
  assert.equal(results[1].paint.id, 'army_painter/matt-black');
});

test('searchPaints applies provider, role, and color filters', () => {
  const providerFiltered = searchPaints(makeRegistry(), 'black', {
    provider: 'army_painter',
  });
  const roleFiltered = searchPaints(makeRegistry(), '', {
    usageRole: 'metallic',
  });
  const colorFiltered = searchPaints(makeRegistry(), '', {
    colorFamily: 'bone',
  });

  assert.deepEqual(providerFiltered.map((result) => result.paint.id), [
    'army_painter/matt-black',
  ]);
  assert.deepEqual(roleFiltered.map((result) => result.paint.id), [
    'citadel/leadbelcher',
  ]);
  assert.deepEqual(colorFiltered.map((result) => result.paint.id), [
    'army_painter/pallid-bone',
  ]);
});

test('resolvePaint reports ambiguous matches', () => {
  const resolution = resolvePaint(makeRegistry(), 'black');

  assert.equal(resolution.status, 'ambiguous');
  assert.deepEqual(
    resolution.matches.map((paint) => paint.id),
    ['citadel/abaddon-black', 'army_painter/matt-black'],
  );
});

test('resolvePaint resolves an exact provider-qualified name', () => {
  const resolution = resolvePaint(makeRegistry(), 'Matt Black', {
    provider: 'army_painter',
  });

  assert.equal(resolution.status, 'resolved');
  assert.equal(resolution.paint.id, 'army_painter/matt-black');
});

test('matchByColor ranks nearest paints with owned-first tie breaking', () => {
  const matches = matchByColor(makeRegistry(), { r: 22, g: 22, b: 22 });

  assert.equal(matches[0].paint.id, 'citadel/abaddon-black');
  assert.equal(matches[1].paint.id, 'army_painter/matt-black');
});
