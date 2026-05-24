import { test, before, after } from 'node:test';
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

let savedInventoryJson;
let savedWarpaintInventoryJson;

before(() => {
  savedInventoryJson = process.env.INVENTORY_JSON;
  savedWarpaintInventoryJson = process.env.WARPAINT_INVENTORY_JSON;
  delete process.env.INVENTORY_JSON;
  delete process.env.WARPAINT_INVENTORY_JSON;
});

after(() => {
  if (savedInventoryJson === undefined) delete process.env.INVENTORY_JSON;
  else process.env.INVENTORY_JSON = savedInventoryJson;
  if (savedWarpaintInventoryJson === undefined) delete process.env.WARPAINT_INVENTORY_JSON;
  else process.env.WARPAINT_INVENTORY_JSON = savedWarpaintInventoryJson;
});

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

test('loadRegistry warns about owned ids that no longer exist in the catalog', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, '.warpaint', 'inventory.json');

  await fs.mkdir(path.dirname(inventoryPath), { recursive: true });
  await fs.writeFile(
    inventoryPath,
    JSON.stringify({
      version: 1,
      owned: ['citadel/abaddon-black', 'citadel/this-paint-was-removed'],
    }, null, 2),
  );

  const warnings = [];
  const registry = await loadRegistry(inventoryPath, { onWarn: (m) => warnings.push(m) });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /citadel\/this-paint-was-removed/);
  const abaddon = registry.catalog.paints.find((p) => p.id === 'citadel/abaddon-black');
  assert.equal(abaddon.owned, true);
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

test('seeds inventory from INVENTORY_JSON when file is absent, then disk wins', async () => {
  const before = process.env.INVENTORY_JSON;
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, '.warpaint', 'inventory.json');
  const seed = JSON.stringify({ version: 1, owned: ['army_painter/holy-white'] });

  process.env.INVENTORY_JSON = seed;
  try {
    const first = await initRegistryIfMissing(inventoryPath);
    assert.equal(first.created, true);

    const owned = first.registry.catalog.paints.filter((p) => p.owned).map((p) => p.id);
    assert.deepEqual(owned, ['army_painter/holy-white']);

    const onDisk = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
    assert.deepEqual(onDisk, { version: 1, owned: ['army_painter/holy-white'] });

    // Change the env to something else; on re-init the existing disk file must win.
    process.env.INVENTORY_JSON = JSON.stringify({ version: 1, owned: [] });
    const second = await initRegistryIfMissing(inventoryPath);
    assert.equal(second.created, false);
    const stillOwned = second.registry.catalog.paints
      .filter((p) => p.owned)
      .map((p) => p.id);
    assert.deepEqual(stillOwned, ['army_painter/holy-white']);
  } finally {
    if (before === undefined) delete process.env.INVENTORY_JSON;
    else process.env.INVENTORY_JSON = before;
  }
});

test('saveRegistry writes to disk even when INVENTORY_JSON env was used as seed', async () => {
  const before = process.env.INVENTORY_JSON;
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, '.warpaint', 'inventory.json');
  process.env.INVENTORY_JSON = JSON.stringify({ version: 1, owned: [] });
  try {
    const { registry } = await initRegistryIfMissing(inventoryPath);
    const target = registry.catalog.paints.find((p) => p.id === 'army_painter/holy-white');
    assert.ok(target);
    target.owned = true;

    await saveRegistry(inventoryPath, registry);

    const onDisk = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
    assert.deepEqual(onDisk.owned, ['army_painter/holy-white']);
  } finally {
    if (before === undefined) delete process.env.INVENTORY_JSON;
    else process.env.INVENTORY_JSON = before;
  }
});
