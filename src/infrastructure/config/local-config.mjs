import os from 'node:os';
import path from 'node:path';

const DATA_DIR = '.minipainting';
const LEGACY_DATA_DIR = '.warpaint';

export function getLocalDataDir(baseDir) {
  return path.join(baseDir, DATA_DIR);
}

export function getLegacyDataDir(baseDir) {
  return path.join(baseDir, LEGACY_DATA_DIR);
}

export function getDefaultInventoryPath() {
  return path.join(os.homedir(), DATA_DIR, 'inventory.json');
}

export function getDefaultRemotesPath() {
  return path.join(os.homedir(), DATA_DIR, 'remotes.json');
}

export function resolveLocalInventoryPath(options = {}) {
  if (options.inventoryPath) return options.inventoryPath;
  if (process.env.INVENTORY_PATH) return process.env.INVENTORY_PATH;
  if (options.cwd) return path.join(options.cwd, DATA_DIR, 'inventory.json');
  return getDefaultInventoryPath();
}

export function resolveLocalRemotesPath(options = {}) {
  if (options.remotesPath) return options.remotesPath;
  if (options.cwd) return path.join(options.cwd, DATA_DIR, 'remotes.json');
  return getDefaultRemotesPath();
}
