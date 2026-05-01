import { loadRegistry, saveRegistry } from '../registry-store.mjs';
import { markOwned, markUnowned } from '../inventory-service.mjs';

function stripPaint(paint) {
  return {
    id: paint.id,
    provider: paint.provider,
    name: paint.name,
    owned: paint.owned,
    usage_roles: paint.usage_roles,
    product_format: paint.product_format ?? null,
    color_families: paint.color_families,
    rgb: paint.rgb,
  };
}

export async function runInventoryCommand(args, context) {
  const registry = await loadRegistry(context.registryPath);
  const [subcommand, ...rest] = args;

  if (subcommand === 'list') {
    return {
      message: 'Owned paints',
      items: registry.catalog.paints.filter((paint) => paint.owned).map(stripPaint),
    };
  }

  const query = rest[0];
  const result = subcommand === 'own'
    ? markOwned(registry, query)
    : markUnowned(registry, query);

  if (result.status === 'updated') {
    await saveRegistry(context.registryPath, result.registry);
    return {
      message: `${result.paint.name} ownership updated`,
      item: stripPaint(result.paint),
    };
  }

  return {
    message: result.status === 'ambiguous' ? 'Paint name is ambiguous' : 'Paint not found',
    items: result.matches.map(stripPaint),
  };
}
