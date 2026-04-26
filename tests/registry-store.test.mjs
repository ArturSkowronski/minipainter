import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadBuiltInCatalog } from '../src/catalog-data.mjs';
import {
  initRegistryIfMissing,
  loadRegistry,
  saveRegistry,
} from '../src/registry-store.mjs';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'warpaint-'));
}

test('loadBuiltInCatalog returns both supported providers with paints', async () => {
  const catalog = await loadBuiltInCatalog();

  assert.deepEqual(catalog.providers.map((provider) => provider.id), [
    'army_painter',
    'citadel',
  ]);
  assert.ok(catalog.paints.length >= 8);
});

test('initRegistryIfMissing creates an empty inventory composed against the catalog', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, '.warpaint', 'inventory.json');

  const created = await initRegistryIfMissing(inventoryPath);
  const registry = await loadRegistry(inventoryPath);

  assert.equal(created.created, true);
  assert.equal(registry.version, 1);
  assert.equal(registry.catalog.providers.length, 2);
  assert.ok(registry.catalog.paints.every((paint) => paint.owned === false));

  const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
  assert.deepEqual(inventory, { version: 1, owned: [] });
});

test('saveRegistry persists owned ids only and preserves them on reload', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, '.warpaint', 'inventory.json');
  const initial = await initRegistryIfMissing(inventoryPath);

  const target = initial.registry.catalog.paints[0];
  target.owned = true;
  await saveRegistry(inventoryPath, initial.registry);

  const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
  assert.deepEqual(inventory, { version: 1, owned: [target.id] });

  const reloaded = await loadRegistry(inventoryPath);
  const reloadedTarget = reloaded.catalog.paints.find((paint) => paint.id === target.id);
  assert.equal(reloadedTarget.owned, true);
});

test('loadRegistry rejects malformed inventory shape', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, '.warpaint', 'inventory.json');

  await fs.mkdir(path.dirname(inventoryPath), { recursive: true });
  await fs.writeFile(
    inventoryPath,
    JSON.stringify({ version: 1, owned: [{ not: 'a string' }] }, null, 2),
  );

  await assert.rejects(() => loadRegistry(inventoryPath), /Invalid inventory shape/);
});

test('initRegistryIfMissing migrates owned state from a legacy registry.json', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, '.warpaint', 'inventory.json');
  const legacyPath = path.join(dir, '.warpaint', 'registry.json');

  await fs.mkdir(path.dirname(legacyPath), { recursive: true });
  const catalog = await loadBuiltInCatalog();
  const ownedTarget = catalog.paints.find((paint) => paint.id === 'citadel/abaddon-black');
  await fs.writeFile(legacyPath, JSON.stringify({
    version: 1,
    catalog: {
      providers: catalog.providers,
      paints: catalog.paints.map((paint) => ({
        ...paint,
        owned: paint.id === ownedTarget.id,
      })),
    },
  }, null, 2));

  const result = await initRegistryIfMissing(inventoryPath);
  const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));

  assert.equal(result.migratedFromLegacy, true);
  assert.deepEqual(inventory.owned, ['citadel/abaddon-black']);
});
