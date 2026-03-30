import fs from 'node:fs/promises';
import path from 'node:path';

import { loadBuiltInCatalog } from './catalog-data.mjs';

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

function validateRegistry(registry) {
  if (
    !registry
    || registry.version !== 1
    || !registry.catalog
    || !Array.isArray(registry.catalog.providers)
    || !Array.isArray(registry.catalog.paints)
  ) {
    throw new Error('Invalid registry shape');
  }

  for (const paint of registry.catalog.paints) {
    validatePaint(paint);
  }
}

export async function loadRegistry(registryPath) {
  const raw = await fs.readFile(registryPath, 'utf8');
  const registry = JSON.parse(raw);
  validateRegistry(registry);
  return registry;
}

export async function saveRegistry(registryPath, registry) {
  validateRegistry(registry);
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(`${registryPath}`, JSON.stringify(registry, null, 2));
}

export async function initRegistryIfMissing(registryPath) {
  try {
    const registry = await loadRegistry(registryPath);
    return { created: false, registry };
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error;
    }
  }

  const catalog = await loadBuiltInCatalog();
  const registry = {
    version: 1,
    catalog,
  };

  await saveRegistry(registryPath, registry);

  return { created: true, registry };
}
