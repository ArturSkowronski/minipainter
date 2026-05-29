import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { handleInventorySync } from '../src/inventory-sync.mjs';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'minipainting-sync-'));
}

function buildContext(overrides = {}) {
  return {
    token: 'secret',
    inventoryPath: overrides.inventoryPath,
    onReload: overrides.onReload || (async () => {}),
  };
}

test('GET returns the current inventory when token matches', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');
  await fs.writeFile(inventoryPath, JSON.stringify({ version: 1, owned: ['army_painter/holy-white'] }));

  const response = await handleInventorySync({
    method: 'GET',
    headers: { authorization: 'Bearer secret' },
    body: null,
    context: buildContext({ inventoryPath }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { version: 1, owned: ['army_painter/holy-white'] });
});

test('POST writes inventory to disk and triggers reload', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');
  let reloadCalls = 0;

  const response = await handleInventorySync({
    method: 'POST',
    headers: { authorization: 'Bearer secret' },
    body: { version: 1, owned: ['citadel/mephiston-red'] },
    context: buildContext({
      inventoryPath,
      onReload: async () => { reloadCalls += 1; },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(reloadCalls, 1);
  const onDisk = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
  assert.deepEqual(onDisk, { version: 1, owned: ['citadel/mephiston-red'] });
});

test('missing or wrong bearer token returns 401', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');

  const noHeader = await handleInventorySync({
    method: 'GET',
    headers: {},
    body: null,
    context: buildContext({ inventoryPath }),
  });
  assert.equal(noHeader.status, 401);

  const wrong = await handleInventorySync({
    method: 'GET',
    headers: { authorization: 'Bearer nope' },
    body: null,
    context: buildContext({ inventoryPath }),
  });
  assert.equal(wrong.status, 401);
});

test('invalid POST body returns 400 and does not write or reload', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');
  let reloadCalls = 0;

  const response = await handleInventorySync({
    method: 'POST',
    headers: { authorization: 'Bearer secret' },
    body: { version: 999, owned: 'nope' },
    context: buildContext({
      inventoryPath,
      onReload: async () => { reloadCalls += 1; },
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(reloadCalls, 0);
  await assert.rejects(fs.access(inventoryPath));
});

test('unauthorized POST does not write or reload', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');
  let reloadCalls = 0;

  const response = await handleInventorySync({
    method: 'POST',
    headers: { authorization: 'Bearer nope' },
    body: { version: 1, owned: ['army_painter/holy-white'] },
    context: buildContext({
      inventoryPath,
      onReload: async () => { reloadCalls += 1; },
    }),
  });

  assert.equal(response.status, 401);
  assert.equal(reloadCalls, 0);
  await assert.rejects(fs.access(inventoryPath));
});

test('non-GET/POST method returns 405', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');

  const response = await handleInventorySync({
    method: 'DELETE',
    headers: { authorization: 'Bearer secret' },
    body: null,
    context: buildContext({ inventoryPath }),
  });
  assert.equal(response.status, 405);
});

test('onReload failure after write returns 500 with explanatory body', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');

  const response = await handleInventorySync({
    method: 'POST',
    headers: { authorization: 'Bearer secret' },
    body: { version: 1, owned: ['army_painter/holy-white'] },
    context: {
      token: 'secret',
      inventoryPath,
      onReload: async () => { throw new Error('boom'); },
    },
  });

  assert.equal(response.status, 500);
  assert.match(response.body.error, /reload failed/);

  // The write still went through — disk is the source of truth.
  const onDisk = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
  assert.deepEqual(onDisk, { version: 1, owned: ['army_painter/holy-white'] });
});

test('sync disabled (no token configured) returns 503', async () => {
  const response = await handleInventorySync({
    method: 'GET',
    headers: { authorization: 'Bearer whatever' },
    body: null,
    context: { token: null, inventoryPath: '/tmp/x' },
  });
  assert.equal(response.status, 503);
});
