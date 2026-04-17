import { resolveRegistryPath } from './config.mjs';
import { initRegistryIfMissing, loadRegistry, saveRegistry } from './registry-store.mjs';
import { markOwned, markUnowned } from './inventory-service.mjs';
import { matchByColor, resolvePaint, searchPaints } from './search-engine.mjs';
import { findEquivalents } from './equivalents-service.mjs';

function toPaintRecord(paint) {
  return {
    id: paint.id,
    name: paint.name,
    provider: paint.provider,
    owned: paint.owned,
    aliases: paint.aliases,
    usage_roles: paint.usage_roles,
    color_families: paint.color_families,
    rgb: paint.rgb,
  };
}

function toSearchRecord(result) {
  return {
    ...toPaintRecord(result.paint),
    score: result.score ?? null,
    distance: result.distance ?? null,
  };
}

function toEquivalentsRecord(equivalents) {
  return {
    source: toPaintRecord(equivalents.source),
    owned: equivalents.owned.map((entry) => ({
      paint: toPaintRecord(entry.paint),
      distance: entry.distance,
    })),
    alternatives: equivalents.alternatives.map((entry) => ({
      paint: toPaintRecord(entry.paint),
      distance: entry.distance,
    })),
    thresholds: equivalents.thresholds,
    ...(equivalents.reason ? { reason: equivalents.reason } : {}),
  };
}

function getRegistryPath(options = {}) {
  return resolveRegistryPath({ cwd: options.cwd, registryPath: options.registryPath });
}

async function loadExistingRegistry(options = {}) {
  return loadRegistry(getRegistryPath(options));
}

export async function initPaintRegistry(options = {}) {
  const registryPath = getRegistryPath(options);
  const result = await initRegistryIfMissing(registryPath);
  return { created: result.created, registry: result.registry };
}

export async function searchPaintCatalog(options = {}) {
  const registry = await loadExistingRegistry(options);
  const items = searchPaints(registry, options.query || '', {
    provider: options.provider,
    owned: options.owned,
    usageRole: options.usage_role,
    colorFamily: options.color_family,
  }).map(toSearchRecord);

  return { status: 'ok', items };
}

export async function showPaint(options = {}) {
  const registry = await loadExistingRegistry(options);
  const result = resolvePaint(registry, options.paint, {
    provider: options.provider,
  });

  if (result.status === 'resolved') {
    const equivalents = findEquivalents(registry, result.paint);
    return {
      status: 'resolved',
      item: toPaintRecord(result.paint),
      equivalents: toEquivalentsRecord(equivalents),
    };
  }

  return {
    status: result.status,
    matches: (result.matches || []).map(toPaintRecord),
  };
}

export async function listInventory(options = {}) {
  const registry = await loadExistingRegistry(options);
  const items = registry.catalog.paints
    .filter((paint) => paint.owned)
    .map(toPaintRecord);

  return { status: 'ok', items };
}

async function mutateInventory(options, mutation) {
  const registryPath = getRegistryPath(options);
  const registry = await loadExistingRegistry(options);
  const result = mutation(registry, options.paint, { provider: options.provider });

  if (result.status === 'updated') {
    await saveRegistry(registryPath, result.registry);
    return { status: 'updated', item: toPaintRecord(result.paint) };
  }

  return {
    status: result.status,
    matches: (result.matches || []).map(toPaintRecord),
  };
}

export async function markInventoryOwned(options = {}) {
  return mutateInventory(options, markOwned);
}

export async function markInventoryUnowned(options = {}) {
  return mutateInventory(options, markUnowned);
}

function parseHex(hex) {
  const value = hex.replace('#', '');

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

export async function matchPaintByColor(options = {}) {
  const registry = await loadExistingRegistry(options);
  const rgb = options.rgb || parseHex(options.hex);
  const items = matchByColor(registry, rgb, {
    provider: options.provider,
    owned: options.owned,
    usageRole: options.usage_role,
    colorFamily: options.color_family,
  }).map(toSearchRecord);

  return { status: 'ok', items };
}

export async function matchPaintByDescription(options = {}) {
  return searchPaintCatalog(options);
}

export async function findPaintEquivalents(options = {}) {
  const registry = await loadExistingRegistry(options);
  const result = findEquivalents(registry, options.paint, {
    maxDistance: options.max_distance,
    limit: options.limit,
    includeSameProvider: options.include_same_provider,
  });

  if (result.status === 'not_found' || result.status === 'ambiguous') {
    return {
      status: result.status,
      matches: (result.matches || []).map(toPaintRecord),
    };
  }

  return { status: 'ok', ...toEquivalentsRecord(result) };
}
