import fs from 'node:fs/promises';
import path from 'node:path';

import { loadBuiltInCatalog } from './catalog-data.mjs';
import { validateInventory } from './inventory-schema.mjs';

function isRgb(value) {
  return value
    && Number.isInteger(value.r)
    && Number.isInteger(value.g)
    && Number.isInteger(value.b);
}

function validatePaint(paint) {
  if (
    !paint
    || typeof paint.id !== 'string'
    || typeof paint.provider !== 'string'
    || typeof paint.name !== 'string'
    || typeof paint.normalized_name !== 'string'
    || !Array.isArray(paint.aliases)
    || !Array.isArray(paint.usage_roles)
    || !Array.isArray(paint.color_families)
    || typeof paint.owned !== 'boolean'
    || !isRgb(paint.rgb)
  ) {
    throw new Error('Invalid paint record');
  }
}

function composeRegistry(catalog, ownedIds) {
  const ownedSet = new Set(ownedIds);
  const registry = {
    version: 1,
    catalog: {
      providers: catalog.providers,
      paints: catalog.paints.map((paint) => ({
        ...paint,
        aliases: [...paint.aliases],
        usage_roles: [...paint.usage_roles],
        color_families: [...paint.color_families],
        rgb: { ...paint.rgb },
        owned: ownedSet.has(paint.id),
      })),
    },
  };

  for (const paint of registry.catalog.paints) {
    validatePaint(paint);
  }

  return registry;
}

function readInventoryFromEnv() {
  const raw = process.env.INVENTORY_JSON || process.env.WARPAINT_INVENTORY_JSON;
  if (!raw) return null;
  const inventory = JSON.parse(raw);
  validateInventory(inventory);
  return inventory;
}

async function readInventoryFile(inventoryPath) {
  const raw = await fs.readFile(inventoryPath, 'utf8');
  const inventory = JSON.parse(raw);
  validateInventory(inventory);
  return inventory;
}

async function tryMigrateLegacyRegistry(inventoryPath) {
  const legacyPath = path.join(path.dirname(inventoryPath), 'registry.json');
  if (legacyPath === inventoryPath) return null;

  try {
    const raw = await fs.readFile(legacyPath, 'utf8');
    const legacy = JSON.parse(raw);
    if (!legacy?.catalog?.paints) return null;
    return legacy.catalog.paints
      .filter((paint) => paint.owned)
      .map((paint) => paint.id)
      .sort();
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
    return null;
  }
}

function findOrphanedOwnedIds(catalog, ownedIds) {
  const known = new Set(catalog.paints.map((paint) => paint.id));
  return ownedIds.filter((id) => !known.has(id));
}

export async function loadRegistry(inventoryPath, options = {}) {
  const catalog = await loadBuiltInCatalog();
  const inventory = await readInventoryFile(inventoryPath);
  const orphans = findOrphanedOwnedIds(catalog, inventory.owned);

  if (orphans.length > 0) {
    const warn = options.onWarn || ((message) => console.warn(message));
    warn(
      `warpaint: inventory references ${orphans.length} unknown paint id(s) not present in the catalog: ${orphans.join(', ')}`,
    );
  }

  return composeRegistry(catalog, inventory.owned);
}

export async function saveRegistry(inventoryPath, registry) {
  const owned = registry.catalog.paints
    .filter((paint) => paint.owned)
    .map((paint) => paint.id)
    .sort();

  const inventory = { version: 1, owned };
  validateInventory(inventory);

  await fs.mkdir(path.dirname(inventoryPath), { recursive: true });
  await fs.writeFile(inventoryPath, JSON.stringify(inventory, null, 2));
}

export async function initRegistryIfMissing(inventoryPath) {
  try {
    const registry = await loadRegistry(inventoryPath);
    if (process.env.INVENTORY_JSON || process.env.WARPAINT_INVENTORY_JSON) {
      console.warn(
        `warpaint: INVENTORY_JSON env is set but ${inventoryPath} already exists — env ignored, disk is source of truth.`,
      );
    }
    return { created: false, registry };
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error;
    }
  }

  const seeded = readInventoryFromEnv();
  const migrated = seeded ? null : await tryMigrateLegacyRegistry(inventoryPath);
  const owned = seeded ? seeded.owned : (migrated || []);

  await fs.mkdir(path.dirname(inventoryPath), { recursive: true });
  await fs.writeFile(
    inventoryPath,
    JSON.stringify({ version: 1, owned }, null, 2),
  );

  const registry = await loadRegistry(inventoryPath);
  return { created: true, registry, migratedFromLegacy: Boolean(migrated && !seeded) };
}
