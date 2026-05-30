import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  initPaintRegistry,
  listInventory,
  markInventoryOwned,
  markInventoryUnowned,
  reloadPaintRegistry,
  searchPaintCatalog,
  showPaint,
  matchPaintByColor,
  matchPaintByDescription,
} from '../src/paint-service.mjs';

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'minipainting-service-'));
}

test('initPaintRegistry initializes a new registry and reports creation', async () => {
  const cwd = await makeWorkspace();

  const result = await initPaintRegistry({ cwd });

  assert.equal(result.created, true);
  assert.equal(result.registry.version, 1);
});

test('searchPaintCatalog returns structured paint records', async () => {
  const cwd = await makeWorkspace();
  await initPaintRegistry({ cwd });

  const result = await searchPaintCatalog({ cwd, query: 'abaddon black' });

  assert.equal(result.status, 'ok');
  assert.equal(result.items[0].id, 'citadel/abaddon-black');
});

test('showPaint returns ambiguous resolution explicitly', async () => {
  const cwd = await makeWorkspace();
  await initPaintRegistry({ cwd });

  const result = await showPaint({ cwd, paint: 'black' });

  assert.equal(result.status, 'ambiguous');
  assert.ok(result.matches.length >= 2);
});

test('inventory mutations persist and inventory list reflects them', async () => {
  const cwd = await makeWorkspace();
  await initPaintRegistry({ cwd });

  const ownResult = await markInventoryOwned({ cwd, paint: 'Abaddon Black' });
  const listResult = await listInventory({ cwd });
  const unownResult = await markInventoryUnowned({ cwd, paint: 'Abaddon Black' });

  assert.equal(ownResult.status, 'updated');
  assert.deepEqual(listResult.items.map((item) => item.id), ['citadel/abaddon-black']);
  assert.equal(unownResult.status, 'updated');
});

test('reloadPaintRegistry returns the freshly loaded registry', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minipainting-'));
  const inventoryPath = path.join(dir, '.minipainting', 'inventory.json');
  await initPaintRegistry({ registryPath: inventoryPath });

  const reloaded = await reloadPaintRegistry({ registryPath: inventoryPath });
  assert.ok(reloaded.registry);
  assert.equal(reloaded.registry.version, 1);
});

test('match services return owned-first structured results', async () => {
  const cwd = await makeWorkspace();
  await initPaintRegistry({ cwd });
  await markInventoryOwned({ cwd, paint: 'Abaddon Black' });

  const colorResult = await matchPaintByColor({ cwd, hex: '#151515' });
  const describeResult = await matchPaintByDescription({ cwd, query: 'bone' });

  assert.equal(colorResult.status, 'ok');
  assert.equal(colorResult.items[0].id, 'citadel/abaddon-black');
  assert.equal(describeResult.status, 'ok');
  assert.ok(describeResult.items.length >= 1);
});
