import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = '.minipainting';
const LEGACY_DATA_DIR = '.warpaint';

export function migrateLegacyDataDir(baseDir) {
  if (!baseDir) return false;
  const target = path.join(baseDir, DATA_DIR);
  const legacy = path.join(baseDir, LEGACY_DATA_DIR);
  if (target === legacy) return false;
  try {
    if (fs.existsSync(target)) return false;
    if (!fs.existsSync(legacy)) return false;
    fs.renameSync(legacy, target);
    console.warn(`minipainting: migrated legacy data directory ${legacy} → ${target}`);
    return true;
  } catch {
    return false;
  }
}

export function getDefaultInventoryPath() {
  return path.join(os.homedir(), DATA_DIR, 'inventory.json');
}

export function resolveInventoryPath(options = {}) {
  if (options.inventoryPath) return options.inventoryPath;
  if (options.registryPath) return options.registryPath;
  if (process.env.INVENTORY_PATH) return process.env.INVENTORY_PATH;
  if (options.cwd) return path.join(options.cwd, DATA_DIR, 'inventory.json');
  return getDefaultInventoryPath();
}

export const getDefaultRegistryPath = getDefaultInventoryPath;
export const resolveRegistryPath = resolveInventoryPath;

export function getDefaultRemotesPath() {
  return path.join(os.homedir(), DATA_DIR, 'remotes.json');
}

export function resolveRemotesPath(options = {}) {
  if (options.remotesPath) return options.remotesPath;
  if (options.cwd) return path.join(options.cwd, DATA_DIR, 'remotes.json');
  return getDefaultRemotesPath();
}
