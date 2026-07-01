import { searchPaintCatalog as runSearchPaintCatalog, showPaint as runShowPaint } from './application/paint-queries.mjs';
import { listInventory as runListInventory } from './application/inventory-queries.mjs';
import { markInventoryOwned as runMarkInventoryOwned, markInventoryUnowned as runMarkInventoryUnowned } from './application/inventory-commands.mjs';
import { matchPaintByColor as runMatchPaintByColor, matchPaintByDescription as runMatchPaintByDescription } from './application/match-queries.mjs';
import { resolveRegistryPath } from './config.mjs';
import { initRegistryIfMissing, loadRegistry, saveRegistry } from './registry-store.mjs';

function getRegistryPath(options = {}) {
  return resolveRegistryPath({ cwd: options.cwd, inventoryPath: options.inventoryPath });
}

function createAppDeps(options = {}) {
  const registryPath = getRegistryPath(options);

  return {
    registryPath,
    async loadRegistry() {
      return loadRegistry(registryPath);
    },
    async saveRegistry(_ignored, registry) {
      await saveRegistry(registryPath, registry);
    },
  };
}

export async function initPaintRegistry(options = {}) {
  const registryPath = getRegistryPath(options);
  const result = await initRegistryIfMissing(registryPath);
  return { created: result.created, registry: result.registry };
}

export async function reloadPaintRegistry(options = {}) {
  const registryPath = getRegistryPath(options);
  const registry = await loadRegistry(registryPath);
  return { registry };
}

export async function searchPaintCatalog(options = {}) {
  return runSearchPaintCatalog(createAppDeps(options), options);
}

export async function showPaint(options = {}) {
  return runShowPaint(createAppDeps(options), options);
}

export async function listInventory(options = {}) {
  return runListInventory(createAppDeps(options), options);
}

export async function markInventoryOwned(options = {}) {
  return runMarkInventoryOwned(createAppDeps(options), options);
}

export async function markInventoryUnowned(options = {}) {
  return runMarkInventoryUnowned(createAppDeps(options), options);
}

export async function matchPaintByColor(options = {}) {
  return runMatchPaintByColor(createAppDeps(options), options);
}

export async function matchPaintByDescription(options = {}) {
  return runMatchPaintByDescription(createAppDeps(options), options);
}
