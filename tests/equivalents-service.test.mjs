import test from 'node:test';
import assert from 'node:assert/strict';

import { findEquivalents } from '../src/equivalents-service.mjs';

function makeRegistry(overrides = []) {
  const basePaints = [
    {
      id: 'citadel/mephiston-red',
      provider: 'citadel',
      name: 'Mephiston Red',
      normalized_name: 'mephiston red',
      aliases: [],
      usage_roles: ['base'],
      color_families: ['red'],
      rgb: { r: 146, g: 27, b: 41 },
      owned: false,
    },
    {
      id: 'army_painter/dragon-red',
      provider: 'army_painter',
      name: 'Dragon Red',
      normalized_name: 'dragon red',
      aliases: [],
      usage_roles: ['base'],
      color_families: ['red'],
      rgb: { r: 170, g: 33, b: 31 },
      owned: false,
    },
    {
      id: 'citadel/agrax-earthshade',
      provider: 'citadel',
      name: 'Agrax Earthshade',
      normalized_name: 'agrax earthshade',
      aliases: [],
      usage_roles: ['shade'],
      color_families: ['brown'],
      rgb: { r: 93, g: 68, b: 49 },
      owned: false,
    },
    {
      id: 'army_painter/skeleton-tone',
      provider: 'army_painter',
      name: 'Skeleton Tone',
      normalized_name: 'skeleton tone',
      aliases: [],
      usage_roles: ['contrast'],
      color_families: ['brown'],
      rgb: { r: 100, g: 72, b: 52 },
      owned: false,
    },
  ];

  const paints = basePaints.map((paint) => {
    const patch = overrides.find((entry) => entry.id === paint.id) || {};
    return { ...paint, ...patch };
  });

  return {
    version: 1,
    catalog: {
      providers: [
        { id: 'citadel', name: 'Citadel' },
        { id: 'army_painter', name: 'Army Painter' },
      ],
      paints,
    },
  };
}

test('findEquivalents returns owned cross-provider match when available', () => {
  const registry = makeRegistry([
    { id: 'army_painter/dragon-red', owned: true },
  ]);

  const result = findEquivalents(registry, 'Mephiston Red');

  assert.equal(result.source.id, 'citadel/mephiston-red');
  assert.deepEqual(result.owned.map((entry) => entry.paint.id), ['army_painter/dragon-red']);
  assert.deepEqual(result.alternatives, []);
  assert.ok(result.owned[0].distance > 0 && result.owned[0].distance < 60);
});

test('findEquivalents falls back to unowned alternatives when nothing owned qualifies', () => {
  const registry = makeRegistry();

  const result = findEquivalents(registry, 'Mephiston Red');

  assert.deepEqual(result.owned, []);
  assert.deepEqual(result.alternatives.map((entry) => entry.paint.id), ['army_painter/dragon-red']);
});

test('findEquivalents treats shade and contrast as the same role', () => {
  const registry = makeRegistry([
    { id: 'army_painter/skeleton-tone', owned: true },
  ]);

  const result = findEquivalents(registry, 'Agrax Earthshade');

  assert.deepEqual(result.owned.map((entry) => entry.paint.id), ['army_painter/skeleton-tone']);
});

test('findEquivalents excludes the source paint itself', () => {
  const registry = makeRegistry([
    { id: 'citadel/mephiston-red', owned: true },
  ]);

  const result = findEquivalents(registry, 'Mephiston Red', {
    includeSameProvider: true,
  });

  const ids = [
    ...result.owned.map((entry) => entry.paint.id),
    ...result.alternatives.map((entry) => entry.paint.id),
  ];
  assert.ok(!ids.includes('citadel/mephiston-red'));
});

test('findEquivalents excludes same provider by default and includes it when opted in', () => {
  const registry = makeRegistry([
    { id: 'citadel/agrax-earthshade', owned: true, rgb: { r: 140, g: 30, b: 40 }, usage_roles: ['base'] },
  ]);

  const defaultResult = findEquivalents(registry, 'Mephiston Red');
  const opened = findEquivalents(registry, 'Mephiston Red', { includeSameProvider: true });

  assert.ok(!defaultResult.owned.some((entry) => entry.paint.provider === 'citadel'));
  assert.ok(opened.owned.some((entry) => entry.paint.id === 'citadel/agrax-earthshade'));
});

test('findEquivalents respects maxDistance and limit', () => {
  const registry = makeRegistry([
    { id: 'army_painter/dragon-red', owned: true },
    { id: 'army_painter/skeleton-tone', owned: true, rgb: { r: 148, g: 29, b: 44 }, usage_roles: ['base'] },
  ]);

  const tight = findEquivalents(registry, 'Mephiston Red', { maxDistance: 5 });
  const capped = findEquivalents(registry, 'Mephiston Red', { limit: 1 });

  assert.deepEqual(tight.owned.map((entry) => entry.paint.id), ['army_painter/skeleton-tone']);
  assert.equal(capped.owned.length, 1);
  assert.equal(capped.owned[0].paint.id, 'army_painter/skeleton-tone');
});

test('findEquivalents sorts by distance then name for ties', () => {
  const registry = makeRegistry([
    { id: 'army_painter/dragon-red', owned: true, rgb: { r: 146, g: 27, b: 41 } },
    { id: 'army_painter/skeleton-tone', owned: true, rgb: { r: 146, g: 27, b: 41 }, usage_roles: ['base'] },
  ]);

  const result = findEquivalents(registry, 'Mephiston Red');

  assert.deepEqual(
    result.owned.map((entry) => entry.paint.id),
    ['army_painter/dragon-red', 'army_painter/skeleton-tone'],
  );
});

test('findEquivalents propagates not_found and ambiguous resolutions', () => {
  const ambiguousRegistry = makeRegistry([
    { id: 'citadel/mephiston-red', aliases: ['red'] },
    { id: 'army_painter/dragon-red', aliases: ['red'] },
  ]);

  const notFound = findEquivalents(ambiguousRegistry, 'Nonexistent Paint');
  assert.equal(notFound.status, 'not_found');
  assert.ok(Array.isArray(notFound.matches));

  const ambiguous = findEquivalents(ambiguousRegistry, 'red');
  assert.equal(ambiguous.status, 'ambiguous');
  assert.ok(ambiguous.matches.length >= 2);
});

test('findEquivalents returns reason when source paint lacks rgb', () => {
  const registry = makeRegistry();
  const noRgb = { ...registry.catalog.paints[0], rgb: null };

  const result = findEquivalents(registry, noRgb);

  assert.deepEqual(result.owned, []);
  assert.deepEqual(result.alternatives, []);
  assert.equal(result.reason, 'source_missing_rgb');
});
