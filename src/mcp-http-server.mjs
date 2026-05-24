#!/usr/bin/env node

import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { resolveInventoryPath } from './config.mjs';
import { initPaintRegistry, reloadPaintRegistry } from './paint-service.mjs';
import { createMcpServer, resolveMcpServerName } from './mcp-tools.mjs';
import { handleInventorySync } from './inventory-sync.mjs';

const PORT = process.env.PORT || 3000;
const SERVER_NAME = resolveMcpServerName();
const INVENTORY_PATH = resolveInventoryPath();
const SYNC_TOKEN = process.env.INVENTORY_SYNC_TOKEN || null;

await initPaintRegistry({ registryPath: INVENTORY_PATH });
console.log('Paint registry initialized.');

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return null;
  return JSON.parse(raw);
}

async function handleInventoryRequest(req, res) {
  let body = null;
  if (req.method === 'POST') {
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON body' }));
      return;
    }
  }

  const result = await handleInventorySync({
    method: req.method,
    headers: req.headers,
    body,
    context: {
      token: SYNC_TOKEN,
      inventoryPath: INVENTORY_PATH,
      onReload: async () => { await reloadPaintRegistry({ registryPath: INVENTORY_PATH }); },
    },
  });

  res.writeHead(result.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result.body));
}

async function handleMcpRequest(req, res) {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcpServer = createMcpServer();

  try {
    await mcpServer.connect(transport);
    let parsedBody;
    if (req.method === 'POST') {
      parsedBody = await readJsonBody(req);
    }
    await transport.handleRequest(req, res, parsedBody);
  } catch (err) {
    console.error('MCP request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  } finally {
    await transport.close().catch(() => {});
  }
}

const httpServer = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url === '/inventory') {
    try {
      await handleInventoryRequest(req, res);
    } catch (err) {
      console.error('Inventory sync error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
    return;
  }

  if (req.url === '/mcp') {
    await handleMcpRequest(req, res);
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

httpServer.listen(PORT, () => {
  console.log(`${SERVER_NAME} MCP HTTP server on port ${PORT}`);
});
