import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createJsonInventoryRepository } from '../src/infrastructure/inventory/json-inventory-repository.mjs';

async function makeTempPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minipainter-inv-'));
  return path.join(dir, 'nested', 'inventory.json');
}

test('load() on a fresh install (no file yet) returns an empty inventory instead of throwing', async () => {
  const inventoryPath = await makeTempPath();
  const repo = createJsonInventoryRepository({ inventoryPath });

  const inventory = await repo.load();

  assert.deepEqual(inventory, { version: 1, owned: [] });
});

test('load() honors the INVENTORY_JSON env seed when no file exists', async () => {
  const inventoryPath = await makeTempPath();
  const repo = createJsonInventoryRepository({ inventoryPath });

  const previous = process.env.INVENTORY_JSON;
  process.env.INVENTORY_JSON = JSON.stringify({ version: 1, owned: ['citadel/abaddon-black'] });
  try {
    const inventory = await repo.load();
    assert.deepEqual(inventory.owned, ['citadel/abaddon-black']);
  } finally {
    if (previous === undefined) delete process.env.INVENTORY_JSON;
    else process.env.INVENTORY_JSON = previous;
  }
});

test('save() then load() round-trips and creates missing parent directories', async () => {
  const inventoryPath = await makeTempPath();
  const repo = createJsonInventoryRepository({ inventoryPath });

  await repo.save({ version: 1, owned: ['citadel/abaddon-black'] });
  const inventory = await repo.load();

  assert.deepEqual(inventory.owned, ['citadel/abaddon-black']);
});

test('load() rethrows non-ENOENT errors (e.g. malformed JSON)', async () => {
  const inventoryPath = await makeTempPath();
  await fs.mkdir(path.dirname(inventoryPath), { recursive: true });
  await fs.writeFile(inventoryPath, '{ not valid json');
  const repo = createJsonInventoryRepository({ inventoryPath });

  await assert.rejects(() => repo.load());
});
