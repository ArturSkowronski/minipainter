import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runCli } from '../src/cli.mjs';

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'warpaint-cli-'));
}

test('catalog sync creates the project-local registry file', async () => {
  const cwd = await makeWorkspace();

  const result = await runCli(['catalog', 'sync'], { cwd });
  const registryPath = path.join(cwd, '.warpaint', 'registry.json');
  const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /initialized/i);
  assert.doesNotMatch(result.stdout, /undefined/);
  assert.equal(registry.version, 1);
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

test('human-readable output includes listed paints, not just summary headers', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });
  await runCli(['inventory', 'own', 'Abaddon Black'], { cwd });

  const search = await runCli(['paint', 'search', 'black'], { cwd });
  const listOwned = await runCli(['inventory', 'list'], { cwd });

  assert.match(search.stdout, /Abaddon Black/);
  assert.match(listOwned.stdout, /Abaddon Black/);
});

test('match equivalents returns owned cross-provider match with json output', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });
  await runCli(['inventory', 'own', 'Matt Black'], { cwd });

  const result = await runCli(['match', 'equivalents', 'Abaddon Black', '--json'], { cwd });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(payload.equivalents.source.id, 'citadel/abaddon-black');
  assert.deepEqual(
    payload.equivalents.owned.map((entry) => entry.paint.id),
    ['army_painter/matt-black'],
  );
  assert.deepEqual(payload.equivalents.alternatives, []);
});

test('match equivalents human output shows owned block when owned qualifies', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });
  await runCli(['inventory', 'own', 'Matt Black'], { cwd });

  const result = await runCli(['match', 'equivalents', 'Abaddon Black'], { cwd });

  assert.match(result.stdout, /Equivalents for:\s+Abaddon Black/);
  assert.match(result.stdout, /Equivalents you own:/);
  assert.match(result.stdout, /Matt Black \(army_painter\)/);
});

test('match equivalents falls back to alternatives when nothing owned', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });

  const result = await runCli(['match', 'equivalents', 'Abaddon Black'], { cwd });

  assert.match(result.stdout, /Nothing owned qualifies/);
  assert.match(result.stdout, /Alternatives:/);
  assert.match(result.stdout, /Matt Black \(army_painter\)/);
});

test('match equivalents reports not_found for unknown paint', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });

  const result = await runCli(['match', 'equivalents', 'Nonexistent Pigment', '--json'], { cwd });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(payload.status, 'not_found');
});

test('match equivalents include-same-provider flag widens the candidate pool', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });
  await runCli(['inventory', 'own', 'Corax White'], { cwd });

  const result = await runCli(
    ['match', 'equivalents', 'Abaddon Black', '--include-same-provider', '--max-distance', '500', '--json'],
    { cwd },
  );
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.equivalents.thresholds.includeSameProvider, true);
  assert.ok(
    payload.equivalents.owned.some((entry) => entry.paint.id === 'citadel/corax-white'),
  );
});
