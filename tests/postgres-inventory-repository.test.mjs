import test from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';

import { createPostgresInventoryRepository } from '../src/infrastructure/inventory/postgres-inventory-repository.mjs';

function makePool() {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}

function makeRepo() {
  return createPostgresInventoryRepository({ pool: makePool() });
}

test('initIfMissing creates the table and returns an empty inventory', async () => {
  const repo = makeRepo();
  const result = await repo.initIfMissing();
  assert.equal(result.created, true);
  assert.deepEqual(result.inventory, { version: 1, owned: [] });

  const loaded = await repo.load();
  assert.deepEqual(loaded, { version: 1, owned: [] });
});

test('save then load round-trips, sorted and de-duplicated', async () => {
  const repo = makeRepo();
  await repo.initIfMissing();

  await repo.save({ version: 1, owned: ['citadel/nuln-oil', 'army_painter/pure-red', 'citadel/nuln-oil'] });
  const loaded = await repo.load();
  assert.deepEqual(loaded.owned, ['army_painter/pure-red', 'citadel/nuln-oil']);
});

test('save replaces the owned set rather than appending', async () => {
  const repo = makeRepo();
  await repo.initIfMissing();

  await repo.save({ version: 1, owned: ['a/one', 'a/two'] });
  await repo.save({ version: 1, owned: ['a/three'] });
  const loaded = await repo.load();
  assert.deepEqual(loaded.owned, ['a/three']);
});

test('initIfMissing seeds from INVENTORY_JSON when the table is empty', async () => {
  const prev = process.env.INVENTORY_JSON;
  process.env.INVENTORY_JSON = JSON.stringify({ version: 1, owned: ['citadel/abaddon-black'] });
  try {
    const repo = makeRepo();
    const result = await repo.initIfMissing();
    assert.equal(result.created, true);
    assert.deepEqual(result.inventory.owned, ['citadel/abaddon-black']);
    assert.deepEqual((await repo.load()).owned, ['citadel/abaddon-black']);
  } finally {
    if (prev === undefined) delete process.env.INVENTORY_JSON;
    else process.env.INVENTORY_JSON = prev;
  }
});

test('initIfMissing on an existing non-empty table reports created:false', async () => {
  const pool = makePool();
  const repo = createPostgresInventoryRepository({ pool });
  await repo.initIfMissing();
  await repo.save({ version: 1, owned: ['a/one'] });

  const again = createPostgresInventoryRepository({ pool });
  const result = await again.initIfMissing();
  assert.equal(result.created, false);
  assert.deepEqual(result.inventory.owned, ['a/one']);
});

test('mutate applies a transform atomically', async () => {
  const repo = makeRepo();
  await repo.initIfMissing();
  await repo.save({ version: 1, owned: ['a/one'] });

  const next = await repo.mutate((current) => ({
    version: 1,
    owned: [...current.owned, 'a/two'],
  }));
  assert.deepEqual(next.owned, ['a/one', 'a/two']);
  assert.deepEqual((await repo.load()).owned, ['a/one', 'a/two']);
});
