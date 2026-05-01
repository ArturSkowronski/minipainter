import { initRegistryIfMissing } from '../registry-store.mjs';
import { loadBuiltInCatalog } from '../catalog-data.mjs';

export async function runCatalogCommand(args, context) {
  const sub = args[0];

  if (sub === 'sync') {
    const result = await initRegistryIfMissing(context.registryPath);
    return {
      message: result.created ? 'Registry initialized from built-in catalogs' : 'Registry already exists',
      item: {
        created: result.created,
        providers: result.registry.catalog.providers.length,
        paints: result.registry.catalog.paints.length,
      },
    };
  }

  if (sub === 'lint') {
    return runCatalogLint();
  }

  throw new Error('Unknown catalog command');
}

async function runCatalogLint() {
  const catalog = await loadBuiltInCatalog();
  const unresolved = catalog.paints
    .filter((paint) => paint.product_format === null)
    .map((paint) => ({ id: paint.id, usage_roles: paint.usage_roles }));

  if (unresolved.length === 0) {
    return {
      message: `Catalog OK: all ${catalog.paints.length} paints have a resolved product_format.`,
      item: {
        total: catalog.paints.length,
        unresolved: 0,
      },
    };
  }

  const error = new Error(
    `Catalog lint failed: ${unresolved.length} paint(s) have no product_format. ` +
      'Add a rule in data/overrides/product_formats.json or an explicit override entry. ' +
      `First: ${unresolved.slice(0, 5).map((p) => p.id).join(', ')}`,
  );
  error.lintReport = { total: catalog.paints.length, unresolved };
  throw error;
}
