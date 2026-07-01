import fs from 'node:fs';

import {
  getDefaultInventoryPath as getDefaultLocalInventoryPath,
  getDefaultRemotesPath as getDefaultLocalRemotesPath,
  getLegacyDataDir,
  getLocalDataDir,
  resolveLocalInventoryPath,
  resolveLocalRemotesPath,
} from './infrastructure/config/local-config.mjs';

export function migrateLegacyDataDir(baseDir) {
  if (!baseDir) return false;
  const target = getLocalDataDir(baseDir);
  const legacy = getLegacyDataDir(baseDir);
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
  return getDefaultLocalInventoryPath();
}

export function resolveInventoryPath(options = {}) {
  return resolveLocalInventoryPath(options);
}

export const getDefaultRegistryPath = getDefaultInventoryPath;
export const resolveRegistryPath = resolveInventoryPath;

export function getDefaultRemotesPath() {
  return getDefaultLocalRemotesPath();
}

export function resolveRemotesPath(options = {}) {
  return resolveLocalRemotesPath(options);
}
