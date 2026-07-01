import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { dispatchHttpRequest } from '../src/transports/http/server.mjs';

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'minipainting-http-'));
}

test('HTTP API exposes paints, inventory mutations, and color match endpoints', async () => {
  const cwd = await makeWorkspace();
  const env = { DATA_DIR: cwd, PORT: '0' };

  const search = await dispatchHttpRequest({ method: 'GET', url: '/api/paints?query=black' }, env);
  assert.equal(search.status, 200);
  assert.ok(search.body.items.some((item) => item.id === 'citadel/abaddon-black'));

  const markOwned = await dispatchHttpRequest({
    method: 'PUT',
    url: `/api/inventory/${encodeURIComponent('Abaddon Black')}`,
  }, env);
  assert.equal(markOwned.status, 200);
  assert.equal(markOwned.body.item.owned, true);

  const inventory = await dispatchHttpRequest({ method: 'GET', url: '/api/inventory' }, env);
  assert.deepEqual(inventory.body.items.map((item) => item.id), ['citadel/abaddon-black']);

  const match = await dispatchHttpRequest({
    method: 'POST',
    url: '/api/match/color',
    body: { hex: '#151515' },
  }, env);
  assert.equal(match.status, 200);
  assert.equal(match.body.items[0].id, 'citadel/abaddon-black');
});

test('HTTP API enforces AUTH_TOKEN when configured', async () => {
  const cwd = await makeWorkspace();
  const env = { DATA_DIR: cwd, PORT: '0', AUTH_TOKEN: 'secret' };

  const denied = await dispatchHttpRequest({ method: 'GET', url: '/api/inventory' }, env);
  assert.equal(denied.status, 401);

  const allowed = await dispatchHttpRequest({
    method: 'GET',
    url: '/api/inventory',
    headers: { authorization: 'Bearer secret' },
  }, env);
  assert.equal(allowed.status, 200);
});
