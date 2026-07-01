import { matchByColor } from '../search-engine.mjs';
import { toSearchRecord } from './dto.mjs';
import { searchPaintCatalog } from './paint-queries.mjs';

function parseHex(hex) {
  const value = hex.replace('#', '');

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

export async function matchPaintByColor({ loadRegistry }, options = {}) {
  const registry = await loadRegistry(options);
  const rgb = options.rgb || parseHex(options.hex);
  const items = matchByColor(registry, rgb, {
    provider: options.provider,
    owned: options.owned,
    usageRole: options.usage_role,
    colorFamily: options.color_family,
  }).map(toSearchRecord);

  return { status: 'ok', items };
}

export async function matchPaintByDescription(deps, options = {}) {
  return searchPaintCatalog(deps, options);
}
