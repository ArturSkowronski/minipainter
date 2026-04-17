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
  searchPaintCatalog,
  showPaint,
  matchPaintByColor,
  matchPaintByDescription,
  findPaintEquivalents,
} from '../src/paint-service.mjs';

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'warpaint-service-'));
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

  const result = await searchPaintCatalog({ cwd, query: 'black' });

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

test('findPaintEquivalents returns owned entries with paint records and thresholds', async () => {
  const cwd = await makeWorkspace();
  await initPaintRegistry({ cwd });
  await markInventoryOwned({ cwd, paint: 'Matt Black' });

  const result = await findPaintEquivalents({ cwd, paint: 'Abaddon Black' });

  assert.equal(result.status, 'ok');
  assert.equal(result.source.id, 'citadel/abaddon-black');
  assert.deepEqual(
    result.owned.map((entry) => entry.paint.id),
    ['army_painter/matt-black'],
  );
  assert.deepEqual(result.alternatives, []);
  assert.equal(result.thresholds.maxDistance, 60);
  assert.equal(result.thresholds.limit, 3);
  assert.equal(result.thresholds.includeSameProvider, false);
});

test('findPaintEquivalents honors max_distance, limit, include_same_provider options', async () => {
  const cwd = await makeWorkspace();
  await initPaintRegistry({ cwd });
  await markInventoryOwned({ cwd, paint: 'Corax White' });

  const result = await findPaintEquivalents({
    cwd,
    paint: 'Abaddon Black',
    max_distance: 500,
    limit: 1,
    include_same_provider: true,
  });

  assert.equal(result.thresholds.includeSameProvider, true);
  assert.equal(result.thresholds.limit, 1);
  assert.equal(result.thresholds.maxDistance, 500);
  assert.ok(result.owned.some((entry) => entry.paint.id === 'citadel/corax-white'));
});

test('findPaintEquivalents returns not_found for unknown paint', async () => {
  const cwd = await makeWorkspace();
  await initPaintRegistry({ cwd });

  const result = await findPaintEquivalents({ cwd, paint: 'Nonexistent' });

  assert.equal(result.status, 'not_found');
});

test('showPaint attaches equivalents shape for resolved paints', async () => {
  const cwd = await makeWorkspace();
  await initPaintRegistry({ cwd });

  const result = await showPaint({ cwd, paint: 'Abaddon Black' });

  assert.equal(result.status, 'resolved');
  assert.equal(result.item.id, 'citadel/abaddon-black');
  assert.ok(result.equivalents);
  assert.equal(result.equivalents.source.id, 'citadel/abaddon-black');
  assert.ok(Array.isArray(result.equivalents.owned));
  assert.ok(Array.isArray(result.equivalents.alternatives));
});
