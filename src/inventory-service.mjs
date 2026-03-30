import { resolvePaint, searchPaints } from './search-engine.mjs';

function cloneRegistry(registry) {
  return {
    ...registry,
    catalog: {
      ...registry.catalog,
      paints: registry.catalog.paints.map((paint) => ({
        ...paint,
        aliases: [...paint.aliases],
        usage_roles: [...paint.usage_roles],
        color_families: [...paint.color_families],
        rgb: { ...paint.rgb },
      })),
    },
  };
}

function updateOwnedState(registry, query, owned, options = {}) {
  const resolution = resolvePaint(registry, query, options);

  if (resolution.status === 'ambiguous') {
    return resolution;
  }

  if (resolution.status === 'not_found') {
    const matches = searchPaints(registry, query, options)
      .slice(0, 5)
      .map((result) => result.paint);

    return { status: 'not_found', matches };
  }

  const nextRegistry = cloneRegistry(registry);
  const index = nextRegistry.catalog.paints.findIndex((paint) => paint.id === resolution.paint.id);

  nextRegistry.catalog.paints[index].owned = owned;

  return {
    status: 'updated',
    registry: nextRegistry,
    paint: nextRegistry.catalog.paints[index],
  };
}

export function markOwned(registry, query, options = {}) {
  return updateOwnedState(registry, query, true, options);
}

export function markUnowned(registry, query, options = {}) {
  return updateOwnedState(registry, query, false, options);
}
