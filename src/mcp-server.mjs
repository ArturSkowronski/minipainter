#!/usr/bin/env node

import os from 'node:os';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { migrateLegacyDataDir } from './config.mjs';
import { createMcpServer, resolveMcpServerName } from './mcp-tools.mjs';

async function main() {
  if (!process.env.INVENTORY_PATH) migrateLegacyDataDir(os.homedir());
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(`${resolveMcpServerName()} MCP server error:`, error);
  process.exit(1);
});
