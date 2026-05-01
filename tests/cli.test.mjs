import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runCli } from '../src/cli.mjs';

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'warpaint-cli-'));
}

test('catalog sync creates the inventory file under the working directory', async () => {
  const cwd = await makeWorkspace();

  const result = await runCli(['catalog', 'sync'], { cwd });
  const inventoryPath = path.join(cwd, '.warpaint', 'inventory.json');
  const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /initialized/i);
  assert.doesNotMatch(result.stdout, /undefined/);
  assert.deepEqual(inventory, { version: 1, owned: [] });
});

test('paint search, show, inventory own/unown, and inventory list support json output', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });

  const search = await runCli(['paint', 'search', 'black', '--json'], { cwd });
  const show = await runCli(['paint', 'show', 'Abaddon Black', '--json'], { cwd });
  const own = await runCli(['inventory', 'own', 'Abaddon Black', '--json'], { cwd });
  const listOwned = await runCli(['inventory', 'list', '--json'], { cwd });
  const unown = await runCli(['inventory', 'unown', 'Abaddon Black', '--json'], { cwd });

  const searchPayload = JSON.parse(search.stdout);
  const showPayload = JSON.parse(show.stdout);
  const ownPayload = JSON.parse(own.stdout);
  const listPayload = JSON.parse(listOwned.stdout);
  const unownPayload = JSON.parse(unown.stdout);

  assert.equal(search.exitCode, 0);
  assert.equal(searchPayload.items[0].id, 'citadel/abaddon-black');
  assert.equal(showPayload.item.id, 'citadel/abaddon-black');
  assert.equal(ownPayload.item.owned, true);
  assert.deepEqual(listPayload.items.map((item) => item.id), ['citadel/abaddon-black']);
  assert.equal(unownPayload.item.owned, false);
});

test('match color and match describe return ranked results', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });
  await runCli(['inventory', 'own', 'Abaddon Black'], { cwd });

  const color = await runCli(['match', 'color', '#151515', '--json'], { cwd });
  const describe = await runCli(['match', 'describe', 'bone', '--json'], { cwd });

  const colorPayload = JSON.parse(color.stdout);
  const describePayload = JSON.parse(describe.stdout);

  assert.equal(color.exitCode, 0);
  assert.equal(colorPayload.items[0].id, 'citadel/abaddon-black');
  assert.equal(describePayload.items[0].id, 'army_painter/pallid-bone');
});

test('catalog lint passes when every paint resolves a product_format', async () => {
  const cwd = await makeWorkspace();

  const result = await runCli(['catalog', 'lint', '--json'], { cwd });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(payload.item.unresolved, 0);
  assert.ok(payload.item.total > 0);
});

test('human-readable output includes listed paints, not just summary headers', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });
  await runCli(['inventory', 'own', 'Abaddon Black'], { cwd });

  const search = await runCli(['paint', 'search', 'black'], { cwd });
  const listOwned = await runCli(['inventory', 'list'], { cwd });

  assert.match(search.stdout, /Abaddon Black/);
  assert.match(listOwned.stdout, /Abaddon Black/);
});
