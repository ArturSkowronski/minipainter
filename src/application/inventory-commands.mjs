import { markOwned, markUnowned } from '../inventory-service.mjs';
import { toPaintRecord } from './dto.mjs';

async function mutateInventory(deps, options, mutation) {
  const registry = await deps.loadRegistry(options);
  const result = mutation(registry, options.paint, { provider: options.provider });

  if (result.status === 'updated') {
    await deps.saveRegistry(options, result.registry);
    return { status: 'updated', item: toPaintRecord(result.paint) };
  }

  return {
    status: result.status,
    matches: (result.matches || []).map(toPaintRecord),
  };
}

export async function markInventoryOwned(deps, options = {}) {
  return mutateInventory(deps, options, markOwned);
}

export async function markInventoryUnowned(deps, options = {}) {
  return mutateInventory(deps, options, markUnowned);
}
