import path from 'node:path';

export function resolveDataDir(env = process.env) {
  return env.DATA_DIR || '/data';
}

export function resolveServerConfig(env = process.env) {
  const dataDir = resolveDataDir(env);

  return {
    port: Number.parseInt(env.PORT || '3000', 10),
    dataDir,
    inventoryPath: env.INVENTORY_PATH || path.join(dataDir, 'inventory.json'),
    remotesPath: env.REMOTES_PATH || path.join(dataDir, 'remotes.json'),
    authToken: env.AUTH_TOKEN || null,
    syncToken: env.INVENTORY_SYNC_TOKEN || env.AUTH_TOKEN || null,
    mcpServerName: env.MCP_SERVER_NAME || 'paint-inventory',
  };
}
