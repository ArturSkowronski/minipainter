import http from 'node:http';

import {
  initPaintRegistry,
  listInventory,
  markInventoryOwned,
  markInventoryUnowned,
  matchPaintByColor,
  matchPaintByDescription,
  reloadPaintRegistry,
  searchPaintCatalog,
  showPaint,
} from '../../paint-service.mjs';
import { createMcpServer } from '../../mcp-tools.mjs';
import { handleInventorySync } from '../../inventory-sync.mjs';
import { resolveServerConfig } from '../../infrastructure/config/runtime-config.mjs';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

function unauthorized(res) {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'unauthorized' }));
}

function isAuthorized(req, expectedToken) {
  if (!expectedToken) return true;
  const header = req.headers.authorization;
  return header === `Bearer ${expectedToken}`;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return null;
  return JSON.parse(raw);
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function makeJsonResult(status, body) {
  return { status, body };
}

async function dispatchApiRequest({ method, url, headers = {}, body }, config) {
  if (config.authToken && !isAuthorized({ headers }, config.authToken)) {
    return makeJsonResult(401, { error: 'unauthorized' });
  }

  const parsedUrl = new URL(url, 'http://localhost');

  if (method === 'GET' && parsedUrl.pathname === '/api/paints') {
    const result = await searchPaintCatalog({
      inventoryPath: config.inventoryPath,
      query: parsedUrl.searchParams.get('query') || '',
      provider: parsedUrl.searchParams.get('provider') || undefined,
      owned: parsedUrl.searchParams.has('owned')
        ? parsedUrl.searchParams.get('owned') === 'true'
        : undefined,
      usage_role: parsedUrl.searchParams.get('usage_role') || undefined,
      color_family: parsedUrl.searchParams.get('color_family') || undefined,
    });
    return makeJsonResult(200, result);
  }

  if (method === 'GET' && parsedUrl.pathname.startsWith('/api/paints/')) {
    const paint = decodeURIComponent(parsedUrl.pathname.slice('/api/paints/'.length));
    const result = await showPaint({ inventoryPath: config.inventoryPath, paint });
    return makeJsonResult(result.status === 'resolved' ? 200 : 404, result);
  }

  if (method === 'GET' && parsedUrl.pathname === '/api/inventory') {
    const result = await listInventory({ inventoryPath: config.inventoryPath });
    return makeJsonResult(200, result);
  }

  if ((method === 'PUT' || method === 'DELETE') && parsedUrl.pathname.startsWith('/api/inventory/')) {
    const paint = decodeURIComponent(parsedUrl.pathname.slice('/api/inventory/'.length));
    const result = method === 'PUT'
      ? await markInventoryOwned({ inventoryPath: config.inventoryPath, paint })
      : await markInventoryUnowned({ inventoryPath: config.inventoryPath, paint });
    return makeJsonResult(result.status === 'updated' ? 200 : 409, result);
  }

  if (method === 'POST' && parsedUrl.pathname === '/api/match/color') {
    const result = await matchPaintByColor({
      inventoryPath: config.inventoryPath,
      hex: body?.hex,
      rgb: body?.rgb,
      provider: body?.provider,
      owned: body?.owned,
      usage_role: body?.usage_role,
      color_family: body?.color_family,
    });
    return makeJsonResult(200, result);
  }

  if (method === 'POST' && parsedUrl.pathname === '/api/match/describe') {
    const result = await matchPaintByDescription({
      inventoryPath: config.inventoryPath,
      query: body?.query || '',
      provider: body?.provider,
      owned: body?.owned,
      usage_role: body?.usage_role,
      color_family: body?.color_family,
    });
    return makeJsonResult(200, result);
  }

  return null;
}

async function handleMcpRequest(req, res, config) {
  if (config.authToken && !isAuthorized(req, config.authToken)) {
    unauthorized(res);
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcpServer = createMcpServer({ inventoryPath: config.inventoryPath });

  try {
    await mcpServer.connect(transport);
    let parsedBody;
    if (req.method === 'POST') {
      parsedBody = await readJsonBody(req);
    }
    await transport.handleRequest(req, res, parsedBody);
  } finally {
    await transport.close().catch(() => {});
  }
}

async function handleLegacyInventoryRequest(req, res, config) {
  let body = null;
  if (req.method === 'POST') {
    try {
      body = await readJsonBody(req);
    } catch {
      writeJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
  }

  const result = await handleInventorySync({
    method: req.method,
    headers: req.headers,
    body,
    context: {
      token: config.syncToken,
      inventoryPath: config.inventoryPath,
      onReload: async () => { await reloadPaintRegistry({ inventoryPath: config.inventoryPath }); },
    },
  });

  writeJson(res, result.status, result.body);
}

export async function dispatchHttpRequest(request, env = process.env) {
  const config = resolveServerConfig(env);
  await initPaintRegistry({ inventoryPath: config.inventoryPath });

  if (request.url === '/health') {
    return makeJsonResult(200, { status: 'ok' });
  }

  if (request.url?.startsWith('/api/')) {
    const result = await dispatchApiRequest(request, config);
    if (result) return result;
  }

  return makeJsonResult(404, { error: 'not found' });
}

export async function createHttpServer(env = process.env) {
  const config = resolveServerConfig(env);
  await initPaintRegistry({ inventoryPath: config.inventoryPath });

  return http.createServer(async (req, res) => {
    try {
      if (req.url === '/health') {
        writeJson(res, 200, { status: 'ok' });
        return;
      }

      if (req.url?.startsWith('/api/')) {
        const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
        const result = await dispatchApiRequest({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        }, config);
        if (result) {
          writeJson(res, result.status, result.body);
          return;
        }
      }

      if (req.url === '/inventory') {
        await handleLegacyInventoryRequest(req, res, config);
        return;
      }

      if (req.url === '/mcp') {
        await handleMcpRequest(req, res, config);
        return;
      }

      writeJson(res, 404, { error: 'not found' });
    } catch (error) {
      console.error('HTTP server error:', error);
      if (!res.headersSent) {
        writeJson(res, 500, { error: 'Internal server error' });
      }
    }
  });
}

export async function startHttpServer(env = process.env) {
  const config = resolveServerConfig(env);
  const server = await createHttpServer(env);

  await new Promise((resolve) => {
    server.listen(config.port, resolve);
  });

  return { server, config };
}
