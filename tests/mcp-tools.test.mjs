import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createMcpServer,
  createMcpToolHandlers,
  getMcpToolDefinitions,
  resolveMcpServerName,
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

test('resolveMcpServerName reads MCP_SERVER_NAME env or defaults to paint-inventory', () => {
  const before = process.env.MCP_SERVER_NAME;
  try {
    delete process.env.MCP_SERVER_NAME;
    assert.equal(resolveMcpServerName(), 'paint-inventory');

    process.env.MCP_SERVER_NAME = 'custom-name';
    assert.equal(resolveMcpServerName(), 'custom-name');
  } finally {
    if (before === undefined) delete process.env.MCP_SERVER_NAME;
    else process.env.MCP_SERVER_NAME = before;
  }
});

test('createMcpServer instantiates without throwing under default and custom names', () => {
  const before = process.env.MCP_SERVER_NAME;
  try {
    delete process.env.MCP_SERVER_NAME;
    assert.doesNotThrow(() => createMcpServer());

    process.env.MCP_SERVER_NAME = 'another-name';
    assert.doesNotThrow(() => createMcpServer());
  } finally {
    if (before === undefined) delete process.env.MCP_SERVER_NAME;
    else process.env.MCP_SERVER_NAME = before;
  }
});

test('README documents local Claude Desktop MCP setup', async () => {
  const readme = await fs.readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /## Claude Desktop MCP Setup/);
  assert.match(readme, /node src\/mcp-server\.mjs/);
  assert.match(readme, /paint_search/);
});
