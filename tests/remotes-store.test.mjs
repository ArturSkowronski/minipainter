import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadRemotes, resolveRemote, saveRemote } from '../src/remotes-store.mjs';

async function makeTempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minipainting-remotes-'));
  return path.join(dir, 'remotes.json');
}

test('loadRemotes returns empty config when file missing', async () => {
  const file = await makeTempFile();
  const remotes = await loadRemotes(file);
  assert.deepEqual(remotes, { version: 1, remotes: {} });
});

test('saveRemote persists and is readable by loadRemotes', async () => {
  const file = await makeTempFile();
  await saveRemote(file, 'prod', { url: 'https://x.fly.dev', token: 't1' });

  const remotes = await loadRemotes(file);
  assert.deepEqual(remotes.remotes.prod, { url: 'https://x.fly.dev', token: 't1' });
});

test('resolveRemote returns named entry, default, or throws', async () => {
  const file = await makeTempFile();
  await saveRemote(file, 'default', { url: 'https://default.fly.dev', token: 'd' });
  await saveRemote(file, 'prod', { url: 'https://prod.fly.dev', token: 'p' });

  assert.deepEqual(await resolveRemote(file, 'prod'), { url: 'https://prod.fly.dev', token: 'p' });
  assert.deepEqual(await resolveRemote(file, null), { url: 'https://default.fly.dev', token: 'd' });
  await assert.rejects(resolveRemote(file, 'nope'), /unknown remote/);
});

test('resolveRemote accepts a raw URL with no token from remotes file', async () => {
  const file = await makeTempFile();
  const resolved = await resolveRemote(file, 'https://adhoc.fly.dev');
  assert.equal(resolved.url, 'https://adhoc.fly.dev');
  assert.equal(resolved.token, null);
});
