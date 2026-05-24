import os from 'node:os';
import path from 'node:path';

export function getDefaultInventoryPath() {
  return path.join(os.homedir(), '.warpaint', 'inventory.json');
}

export function resolveInventoryPath(options = {}) {
  if (options.inventoryPath) return options.inventoryPath;
  if (options.registryPath) return options.registryPath;
  if (process.env.INVENTORY_PATH) return process.env.INVENTORY_PATH;
  if (options.cwd) return path.join(options.cwd, '.warpaint', 'inventory.json');
  return getDefaultInventoryPath();
}

export const getDefaultRegistryPath = getDefaultInventoryPath;
export const resolveRegistryPath = resolveInventoryPath;

export function getDefaultRemotesPath() {
  return path.join(os.homedir(), '.warpaint', 'remotes.json');
}

export function resolveRemotesPath(options = {}) {
  if (options.remotesPath) return options.remotesPath;
  if (options.cwd) return path.join(options.cwd, '.warpaint', 'remotes.json');
  return getDefaultRemotesPath();
}
