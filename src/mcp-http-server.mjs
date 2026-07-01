#!/usr/bin/env node

import { startHttpServer } from './transports/http/server.mjs';

const { config } = await startHttpServer();
console.log(`${config.mcpServerName} HTTP server on port ${config.port}`);
