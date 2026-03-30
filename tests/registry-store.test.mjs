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

test('initRegistryIfMissing creates a registry seeded from built-in catalogs', async () => {
  const dir = await makeTempDir();
  const registryPath = path.join(dir, '.warpaint', 'registry.json');

  const created = await initRegistryIfMissing(registryPath);
  const registry = await loadRegistry(registryPath);

  assert.equal(created.created, true);
  assert.equal(registry.version, 1);
  assert.equal(registry.catalog.providers.length, 2);
  assert.ok(registry.catalog.paints.every((paint) => paint.owned === false));
});

test('saveRegistry preserves owned state changes', async () => {
  const dir = await makeTempDir();
  const registryPath = path.join(dir, '.warpaint', 'registry.json');
  const initial = await initRegistryIfMissing(registryPath);

  initial.registry.catalog.paints[0].owned = true;
  await saveRegistry(registryPath, initial.registry);

  const reloaded = await loadRegistry(registryPath);

  assert.equal(reloaded.catalog.paints[0].owned, true);
});

test('loadRegistry rejects malformed registry shape', async () => {
  const dir = await makeTempDir();
  const registryPath = path.join(dir, '.warpaint', 'registry.json');

  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(
    registryPath,
    JSON.stringify({ version: 1, catalog: { providers: [], paints: [{}] } }, null, 2),
  );

  await assert.rejects(() => loadRegistry(registryPath), /Invalid paint record/);
});
