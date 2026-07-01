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

export function composePaintIndex(catalog, inventory, options = {}) {
  const ownedSet = new Set(inventory.owned);
  const knownIds = new Set(catalog.paints.map((paint) => paint.id));
  const orphans = inventory.owned.filter((id) => !knownIds.has(id));

  if (orphans.length > 0) {
    const warn = options.onWarn || ((message) => console.warn(message));
    warn(
      `minipainting: inventory references ${orphans.length} unknown paint id(s) not present in the catalog: ${orphans.join(', ')}`,
    );
  }

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
