export function toPaintRecord(paint) {
  return {
    id: paint.id,
    name: paint.name,
    provider: paint.provider,
    owned: paint.owned,
    aliases: paint.aliases,
    usage_roles: paint.usage_roles,
    product_format: paint.product_format ?? null,
    color_families: paint.color_families,
    rgb: paint.rgb,
  };
}

export function toSearchRecord(result) {
  return {
    ...toPaintRecord(result.paint),
    score: result.score ?? null,
    distance: result.distance ?? null,
  };
}

export function toCatalogSummary(registry) {
  return {
    created: true,
    providers: registry.catalog.providers.length,
    paints: registry.catalog.paints.length,
  };
}
