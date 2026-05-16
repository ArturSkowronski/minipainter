#!/usr/bin/env node

import http from 'node:http';
import process from 'node:process';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createMcpServer } from './mcp-tools.mjs';

const PORT = Number.parseInt(process.env.PORT ?? '8080', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const TOKEN = process.env.WARPAINT_TOKEN ?? '';
const INVENTORY_PATH = process.env.WARPAINT_INVENTORY_PATH ?? '';

if (!TOKEN) {
  console.error('WARPAINT_TOKEN is required. Refusing to start without auth.');
  process.exit(1);
}

function unauthorized(res) {
  res.statusCode = 401;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'unauthorized' }));
}

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'not_found' }));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  return JSON.parse(raw);
}

async function handleMcp(req, res) {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(INVENTORY_PATH ? { registryPath: INVENTORY_PATH } : {});

  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  await server.connect(transport);

  let body;
  if (req.method === 'POST') {
    try {
      body = await readJsonBody(req);
    } catch {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }
  }

  await transport.handleRequest(req, res, body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/' || url.pathname === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain');
      res.end('warpaint-mcp ok\n');
      return;
    }

    if (url.pathname !== '/mcp') {
      notFound(res);
      return;
    }

    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${TOKEN}`) {
      unauthorized(res);
      return;
    }

    await handleMcp(req, res);
  } catch (error) {
    console.error('warpaint-mcp request error:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'internal_error' }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`warpaint-mcp listening on http://${HOST}:${PORT}/mcp`);
});
