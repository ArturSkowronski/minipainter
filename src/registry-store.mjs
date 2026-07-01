import { composePaintIndex } from './application/compose-paint-index.mjs';
import { loadBuiltInCatalog } from './catalog-data.mjs';
import { createJsonInventoryRepository } from './infrastructure/inventory/json-inventory-repository.mjs';
import { createPostgresInventoryRepository } from './infrastructure/inventory/postgres-inventory-repository.mjs';
import { getPool } from './infrastructure/inventory/pg-pool.mjs';

// DATABASE_URL selects the Postgres-backed inventory (Docker/remote deploys); otherwise
// inventory lives in a local JSON file exactly as before. Consumers are unaware either way.
function getRepository(inventoryPath) {
  if (process.env.DATABASE_URL) {
    return createPostgresInventoryRepository({ pool: getPool() });
  }
  return createJsonInventoryRepository({ inventoryPath });
}

export async function loadRegistry(inventoryPath, options = {}) {
  const [catalog, inventory] = await Promise.all([
    loadBuiltInCatalog(),
    getRepository(inventoryPath).load(),
  ]);

  return composePaintIndex(catalog, inventory, options);
}

export async function saveRegistry(inventoryPath, registry) {
  const owned = registry.catalog.paints
    .filter((paint) => paint.owned)
    .map((paint) => paint.id)
    .sort();

  await getRepository(inventoryPath).save({ version: 1, owned });
}

export async function initRegistryIfMissing(inventoryPath) {
  const repository = getRepository(inventoryPath);
  const result = await repository.initIfMissing();
  const catalog = await loadBuiltInCatalog();
  const registry = composePaintIndex(catalog, result.inventory);

  return {
    ...result,
    registry,
  };
}
