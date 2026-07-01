import { toPaintRecord } from './dto.mjs';

export async function listInventory({ loadRegistry }, options = {}) {
  const registry = await loadRegistry(options);
  const items = registry.catalog.paints
    .filter((paint) => paint.owned)
    .map(toPaintRecord);

  return { status: 'ok', items };
}
