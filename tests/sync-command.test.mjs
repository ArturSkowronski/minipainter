import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { runSyncCommand } from '../src/commands/sync.mjs';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'minipainting-sync-cmd-'));
}

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      handler(req, body, res);
    });
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

test('sync push uploads local inventory to the remote', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');
  const remotesPath = path.join(dir, 'remotes.json');
  await fs.writeFile(inventoryPath, JSON.stringify({ version: 1, owned: ['army_painter/holy-white'] }));

  let received = null;
  let receivedAuth = null;
  const { server, port } = await startMockServer((req, body, res) => {
    receivedAuth = req.headers.authorization;
    received = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });

  try {
    const result = await runSyncCommand(
      ['push', '--remote', `http://localhost:${port}`, '--token', 'tk'],
      { inventoryPath, remotesPath },
    );
    assert.equal(result.status, 'pushed');
    assert.equal(receivedAuth, 'Bearer tk');
    assert.deepEqual(received, { version: 1, owned: ['army_painter/holy-white'] });
  } finally {
    server.close();
  }
});

test('sync pull writes remote inventory locally', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');
  const remotesPath = path.join(dir, 'remotes.json');

  const { server, port } = await startMockServer((_req, _body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: 1, owned: ['citadel/mephiston-red'] }));
  });

  try {
    const result = await runSyncCommand(
      ['pull', '--remote', `http://localhost:${port}`, '--token', 'tk', '--force'],
      { inventoryPath, remotesPath },
    );
    assert.equal(result.status, 'pulled');

    const onDisk = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
    assert.deepEqual(onDisk, { version: 1, owned: ['citadel/mephiston-red'] });
  } finally {
    server.close();
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
