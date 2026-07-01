import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createHttpServer } from '../src/transports/http/server.mjs';

async function makeEnv() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgpt-http-'));
  return { DATA_DIR: cwd, PORT: '0', PUBLIC_BASE_URL: 'https://example.test' };
}

async function startServer(env) {
  const server = await createHttpServer(env);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

// Minimal MCP-over-HTTP call that handles both JSON and SSE responses.
async function mcpCall(base, message) {
  const res = await fetch(`${base}/mcp/v3`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(message),
  });
  const raw = await res.text();
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    const dataLine = raw.split('\n').find((line) => line.startsWith('data:'));
    return JSON.parse(dataLine.slice('data:'.length).trim());
  }
  return JSON.parse(raw);
}

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  },
};

test('/mcp/v3 exposes ChatGPT search + fetch tools', async () => {
  const env = await makeEnv();
  const { server, base } = await startServer(env);
  try {
    await mcpCall(base, INIT);
    const list = await mcpCall(base, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const names = list.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['fetch', 'match_color', 'search']);
  } finally {
    server.close();
  }
});

test('/mcp/v3 search then fetch returns the ChatGPT contract JSON', async () => {
  const env = await makeEnv();
  const { server, base } = await startServer(env);
  try {
    await mcpCall(base, INIT);

    const search = await mcpCall(base, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'nuln oil' } },
    });
    const searchPayload = JSON.parse(search.result.content[0].text);
    const hit = searchPayload.results.find((r) => r.id === 'citadel/nuln-oil');
    assert.ok(hit, 'search should return citadel/nuln-oil');
    assert.equal(hit.url, 'https://example.test/api/paints/citadel/nuln-oil');

    const fetched = await mcpCall(base, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'fetch', arguments: { id: hit.id } },
    });
    const doc = JSON.parse(fetched.result.content[0].text);
    assert.equal(doc.id, 'citadel/nuln-oil');
    assert.ok(doc.text.length > 0);
    assert.equal(typeof doc.metadata, 'object');
  } finally {
    server.close();
  }
});
