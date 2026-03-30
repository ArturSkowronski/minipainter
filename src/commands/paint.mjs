import { loadRegistry } from '../registry-store.mjs';
import { resolvePaint, searchPaints } from '../search-engine.mjs';

function stripResult(result) {
  return {
    id: result.paint.id,
    provider: result.paint.provider,
    name: result.paint.name,
    owned: result.paint.owned,
    usage_roles: result.paint.usage_roles,
    color_families: result.paint.color_families,
    rgb: result.paint.rgb,
    score: result.score,
  };
}

function stripPaint(paint) {
  return {
    id: paint.id,
    provider: paint.provider,
    name: paint.name,
    owned: paint.owned,
    aliases: paint.aliases,
    usage_roles: paint.usage_roles,
    color_families: paint.color_families,
    rgb: paint.rgb,
  };
}

export async function runPaintCommand(args, context) {
  const registry = await loadRegistry(context.registryPath);
  const [subcommand, ...rest] = args;

  if (subcommand === 'search') {
    const query = rest[0] || '';
    const items = searchPaints(registry, query).map(stripResult);
    return {
      message: `Found ${items.length} paint matches`,
      items,
    };
  }

  if (subcommand === 'show') {
    const query = rest[0];
    const result = resolvePaint(registry, query);

    if (result.status !== 'resolved') {
      return {
        message: 'Paint could not be resolved',
        item: null,
        items: result.matches?.map(stripPaint) || [],
      };
    }

    return {
      message: `Showing ${result.paint.name}`,
      item: stripPaint(result.paint),
    };
  }

  throw new Error('Unknown paint command');
}
