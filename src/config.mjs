import os from 'node:os';
import path from 'node:path';

export function getDefaultInventoryPath() {
  return path.join(os.homedir(), '.warpaint', 'inventory.json');
}

export function resolveInventoryPath(options = {}) {
  if (options.inventoryPath) return options.inventoryPath;
  if (options.registryPath) return options.registryPath;
  if (options.cwd) return path.join(options.cwd, '.warpaint', 'inventory.json');
  return getDefaultInventoryPath();
}

export const getDefaultRegistryPath = getDefaultInventoryPath;
export const resolveRegistryPath = resolveInventoryPath;
