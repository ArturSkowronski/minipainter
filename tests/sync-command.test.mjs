import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runSyncCommand } from '../src/commands/sync.mjs';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'minipainting-sync-cmd-'));
}

test('sync push uploads local inventory to the remote', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');
  const remotesPath = path.join(dir, 'remotes.json');
  await fs.writeFile(inventoryPath, JSON.stringify({ version: 1, owned: ['army_painter/holy-white'] }));

  let received = null;
  let receivedAuth = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    receivedAuth = options.headers?.Authorization;
    received = JSON.parse(options.body);
    return new Response(JSON.stringify(received), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await runSyncCommand(
      ['push', '--remote', 'http://example.test', '--token', 'tk'],
      { inventoryPath, remotesPath },
    );
    assert.equal(result.status, 'pushed');
    assert.equal(receivedAuth, 'Bearer tk');
    assert.deepEqual(received, { version: 1, owned: ['army_painter/holy-white'] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sync pull writes remote inventory locally', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');
  const remotesPath = path.join(dir, 'remotes.json');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ version: 1, owned: ['citadel/mephiston-red'] }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );

  try {
    const result = await runSyncCommand(
      ['pull', '--remote', 'http://example.test', '--token', 'tk', '--force'],
      { inventoryPath, remotesPath },
    );
    assert.equal(result.status, 'pulled');

    const onDisk = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
    assert.deepEqual(onDisk, { version: 1, owned: ['citadel/mephiston-red'] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sync add registers a remote in remotes.json', async () => {
  const dir = await makeTempDir();
  const remotesPath = path.join(dir, 'remotes.json');

  const result = await runSyncCommand(
    ['add', 'default', '--url', 'https://my.fly.dev', '--token', 'tk'],
    { inventoryPath: path.join(dir, 'inventory.json'), remotesPath },
  );

  assert.equal(result.status, 'added');
  const onDisk = JSON.parse(await fs.readFile(remotesPath, 'utf8'));
  assert.deepEqual(onDisk.remotes.default, { url: 'https://my.fly.dev', token: 'tk' });
});
