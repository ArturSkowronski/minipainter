import test from 'node:test';
import assert from 'node:assert/strict';

import { markOwned, markUnowned } from '../src/inventory-service.mjs';

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
          owned: false,
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
      ],
    },
  };
}

test('markOwned updates a paint by name', () => {
  const result = markOwned(makeRegistry(), 'Abaddon Black');

  assert.equal(result.status, 'updated');
  assert.equal(result.paint.owned, true);
  assert.equal(result.registry.catalog.paints[0].owned, true);
});

test('markUnowned clears owned state', () => {
  const registry = makeRegistry();
  registry.catalog.paints[0].owned = true;

  const result = markUnowned(registry, 'Abaddon Black');

  assert.equal(result.status, 'updated');
  assert.equal(result.paint.owned, false);
});

test('markOwned returns ambiguous matches when name is not specific enough', () => {
  const result = markOwned(makeRegistry(), 'black');

  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(
    result.matches.map((paint) => paint.id),
    ['citadel/abaddon-black', 'army_painter/matt-black'],
  );
});

test('markOwned returns close matches when no exact match exists', () => {
  const result = markOwned(makeRegistry(), 'abbadon');

  assert.equal(result.status, 'not_found');
  assert.deepEqual(
    result.matches.map((paint) => paint.id),
    ['citadel/abaddon-black'],
  );
});
