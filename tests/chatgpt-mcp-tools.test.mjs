import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildSearchResults,
  buildFetchResult,
  createChatGptToolHandlers,
} from '../src/chatgpt-mcp-tools.mjs';
import { initPaintRegistry, markInventoryOwned } from '../src/paint-service.mjs';

const BASE = 'https://example.test';

async function makeWorkspace() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgpt-mcp-'));
  await initPaintRegistry({ inventoryPath: path.join(cwd, 'inventory.json') });
  return path.join(cwd, 'inventory.json');
}

function parseToolJson(result) {
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}

test('buildSearchResults maps items to id/title/url and caps to limit', () => {
  const catalog = {
    status: 'ok',
    items: [
      { id: 'citadel/nuln-oil', name: 'Nuln Oil', provider: 'citadel' },
      { id: 'vallejo/black', name: 'Black', provider: 'vallejo' },
      { id: 'citadel/abaddon-black', name: 'Abaddon Black', provider: 'citadel' },
    ],
  };

  const out = buildSearchResults(catalog, { baseUrl: BASE, limit: 2 });
  assert.equal(out.results.length, 2);
  assert.deepEqual(out.results[0], {
    id: 'citadel/nuln-oil',
    title: 'Nuln Oil (citadel)',
    url: 'https://example.test/api/paints/citadel/nuln-oil',
  });
});

test('buildSearchResults tolerates missing/empty input', () => {
  assert.deepEqual(buildSearchResults(undefined, { baseUrl: BASE }).results, []);
  assert.deepEqual(buildSearchResults({ items: [] }, { baseUrl: BASE }).results, []);
});

test('buildFetchResult renders a resolved paint into the ChatGPT fetch doc', () => {
  const show = {
    status: 'resolved',
    item: {
      id: 'citadel/nuln-oil',
      name: 'Nuln Oil',
      provider: 'citadel',
      owned: true,
      aliases: [],
      usage_roles: ['shade'],
      product_format: 'wash',
      color_families: ['black'],
      rgb: { r: 26, g: 26, b: 26 },
    },
  };

  const doc = buildFetchResult(show, 'citadel/nuln-oil', { baseUrl: BASE });
  assert.equal(doc.id, 'citadel/nuln-oil');
  assert.equal(doc.title, 'Nuln Oil (citadel)');
  assert.equal(doc.url, 'https://example.test/api/paints/citadel/nuln-oil');
  assert.match(doc.text, /wash/);
  assert.match(doc.text, /#1a1a1a/);
  assert.match(doc.text, /Owned: yes/);
  // metadata values must be strings (ChatGPT-safe)
  for (const value of Object.values(doc.metadata)) {
    assert.equal(typeof value, 'string');
  }
  assert.equal(doc.metadata.product_format, 'wash');
});

test('buildFetchResult returns a well-formed doc for not_found', () => {
  const doc = buildFetchResult({ status: 'not_found', matches: [] }, 'nope/nope', { baseUrl: BASE });
  assert.equal(doc.id, 'nope/nope');
  assert.match(doc.text, /No paint found/i);
  assert.equal(doc.metadata.status, 'not_found');
});

test('buildFetchResult lists candidates for ambiguous', () => {
  const doc = buildFetchResult({
    status: 'ambiguous',
    matches: [{ id: 'a/x', name: 'X', provider: 'a' }, { id: 'b/x', name: 'X', provider: 'b' }],
  }, 'x', { baseUrl: BASE });
  assert.match(doc.text, /a\/x/);
  assert.match(doc.text, /b\/x/);
});

test('search handler returns ChatGPT results JSON against the real catalog', async () => {
  const inventoryPath = await makeWorkspace();
  const handlers = createChatGptToolHandlers({ inventoryPath, baseUrl: BASE });

  const result = await handlers.search({ query: 'nuln' });
  const payload = parseToolJson(result);
  assert.ok(Array.isArray(payload.results));
  const nuln = payload.results.find((r) => r.id === 'citadel/nuln-oil');
  assert.ok(nuln, 'expected Nuln Oil in results');
  assert.equal(nuln.url, 'https://example.test/api/paints/citadel/nuln-oil');
});

test('fetch handler resolves a paint id and reflects owned state', async () => {
  const inventoryPath = await makeWorkspace();
  await markInventoryOwned({ inventoryPath, paint: 'citadel/nuln-oil' });
  const handlers = createChatGptToolHandlers({ inventoryPath, baseUrl: BASE });

  const result = await handlers.fetch({ id: 'citadel/nuln-oil' });
  const doc = parseToolJson(result);
  assert.equal(doc.id, 'citadel/nuln-oil');
  assert.match(doc.text, /Owned: yes/);
});

test('match_color handler returns catalog matches as JSON', async () => {
  const inventoryPath = await makeWorkspace();
  const handlers = createChatGptToolHandlers({ inventoryPath, baseUrl: BASE });

  const result = await handlers.match_color({ hex: '#151515' });
  const payload = parseToolJson(result);
  assert.equal(payload.items[0].id, 'citadel/abaddon-black');
});
