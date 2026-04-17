import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createMcpToolHandlers,
  getMcpToolDefinitions,
} from '../src/mcp-tools.mjs';

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'warpaint-mcp-'));
}

test('getMcpToolDefinitions exposes the expected tool names', () => {
  const definitions = getMcpToolDefinitions();

  assert.deepEqual(
    definitions.map((tool) => tool.name),
    [
      'paint_search',
      'paint_show',
      'inventory_list',
      'inventory_mark_owned',
      'inventory_mark_unowned',
      'match_color',
      'match_describe',
      'paint_equivalents',
    ],
  );
});

test('MCP handlers expose search and show operations', async () => {
  const cwd = await makeWorkspace();
  const handlers = createMcpToolHandlers({ cwd });

  await handlers.paint_search({ query: 'black', initialize_registry: true });
  const showResult = await handlers.paint_show({ paint: 'Abaddon Black' });

  assert.equal(showResult.status, 'resolved');
  assert.equal(showResult.item.id, 'citadel/abaddon-black');
});

test('MCP handlers persist inventory updates', async () => {
  const cwd = await makeWorkspace();
  const handlers = createMcpToolHandlers({ cwd });

  await handlers.inventory_mark_owned({ paint: 'Abaddon Black', initialize_registry: true });
  const listResult = await handlers.inventory_list({});
  const unownResult = await handlers.inventory_mark_unowned({ paint: 'Abaddon Black' });

  assert.deepEqual(listResult.items.map((item) => item.id), ['citadel/abaddon-black']);
  assert.equal(unownResult.status, 'updated');
});

test('MCP handlers expose match tools', async () => {
  const cwd = await makeWorkspace();
  const handlers = createMcpToolHandlers({ cwd });

  await handlers.inventory_mark_owned({ paint: 'Abaddon Black', initialize_registry: true });
  const colorResult = await handlers.match_color({ hex: '#151515' });
  const describeResult = await handlers.match_describe({ query: 'bone' });

  assert.equal(colorResult.items[0].id, 'citadel/abaddon-black');
  assert.ok(describeResult.items.length >= 1);
});

test('paint_equivalents tool returns owned-first structured results', async () => {
  const cwd = await makeWorkspace();
  const handlers = createMcpToolHandlers({ cwd });

  await handlers.inventory_mark_owned({ paint: 'Matt Black', initialize_registry: true });
  const result = await handlers.paint_equivalents({ paint: 'Abaddon Black' });

  assert.equal(result.status, 'ok');
  assert.equal(result.source.id, 'citadel/abaddon-black');
  assert.deepEqual(
    result.owned.map((entry) => entry.paint.id),
    ['army_painter/matt-black'],
  );
  assert.deepEqual(result.alternatives, []);
  assert.equal(result.thresholds.includeSameProvider, false);
});

test('paint_equivalents tool reports not_found for unknown paint', async () => {
  const cwd = await makeWorkspace();
  const handlers = createMcpToolHandlers({ cwd });

  const result = await handlers.paint_equivalents({ paint: 'Nonexistent', initialize_registry: true });

  assert.equal(result.status, 'not_found');
});

test('paint_equivalents tool reports ambiguous for alias that resolves to multiple paints', async () => {
  const cwd = await makeWorkspace();
  const handlers = createMcpToolHandlers({ cwd });

  const result = await handlers.paint_equivalents({ paint: 'black', initialize_registry: true });

  assert.equal(result.status, 'ambiguous');
  assert.ok(result.matches.length >= 2);
});

test('paint_show tool response includes equivalents field', async () => {
  const cwd = await makeWorkspace();
  const handlers = createMcpToolHandlers({ cwd });

  const result = await handlers.paint_show({ paint: 'Abaddon Black', initialize_registry: true });

  assert.equal(result.status, 'resolved');
  assert.ok(result.equivalents);
  assert.equal(result.equivalents.source.id, 'citadel/abaddon-black');
  assert.ok(Array.isArray(result.equivalents.owned));
  assert.ok(Array.isArray(result.equivalents.alternatives));
});

test('README documents local Claude Desktop MCP setup and new tools', async () => {
  const readme = await fs.readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /## Claude Desktop MCP Setup/);
  assert.match(readme, /node src\/mcp-server\.mjs/);
  assert.match(readme, /paint_search/);
  assert.match(readme, /paint_equivalents/);
});
