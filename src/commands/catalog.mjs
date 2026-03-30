import { initRegistryIfMissing } from '../registry-store.mjs';

export async function runCatalogCommand(args, context) {
  if (args[0] !== 'sync') {
    throw new Error('Unknown catalog command');
  }

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
