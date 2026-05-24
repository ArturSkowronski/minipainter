#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createMcpServer, resolveMcpServerName } from './mcp-tools.mjs';

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(`${resolveMcpServerName()} MCP server error:`, error);
  process.exit(1);
});
