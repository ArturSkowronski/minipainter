import { loadRegistry } from '../registry-store.mjs';
import { matchByColor, searchPaints } from '../search-engine.mjs';

function stripMatch(result) {
  return {
    id: result.paint.id,
    provider: result.paint.provider,
    name: result.paint.name,
    owned: result.paint.owned,
    usage_roles: result.paint.usage_roles,
    product_format: result.paint.product_format ?? null,
    color_families: result.paint.color_families,
    rgb: result.paint.rgb,
    distance: result.distance ?? null,
    score: result.score ?? null,
  };
}

function parseHexColor(value) {
  const normalized = value.replace('#', '');

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error('Color must be a 6-digit hex value');
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

export async function runMatchCommand(args, context) {
  const registry = await loadRegistry(context.registryPath);
  const [subcommand, ...rest] = args;

  if (subcommand === 'color') {
    const rgb = parseHexColor(rest[0]);
    return {
      message: 'Color matches',
      items: matchByColor(registry, rgb).map(stripMatch),
    };
  }

  if (subcommand === 'describe') {
    return {
      message: 'Described paint matches',
      items: searchPaints(registry, rest[0] || '').map(stripMatch),
    };
  }

  throw new Error('Unknown match command');
}
