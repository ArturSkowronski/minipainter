#!/usr/bin/env node

import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { initPaintRegistry } from './paint-service.mjs';
import { createMcpServer } from './mcp-tools.mjs';

const PORT = process.env.PORT || 3000;

await initPaintRegistry();
console.log('Paint registry initialized.');

const httpServer = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url !== '/mcp') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcpServer = createMcpServer();

  try {
    await mcpServer.connect(transport);

    let parsedBody;
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      if (raw) parsedBody = JSON.parse(raw);
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
});

httpServer.listen(PORT, () => {
  console.log(`Warpaint MCP HTTP server on port ${PORT}`);
});
