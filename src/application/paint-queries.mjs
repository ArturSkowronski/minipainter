import { resolvePaint, searchPaints } from '../search-engine.mjs';
import { toPaintRecord, toSearchRecord } from './dto.mjs';

export async function searchPaintCatalog({ loadRegistry }, options = {}) {
  const registry = await loadRegistry(options);
  const items = searchPaints(registry, options.query || '', {
    provider: options.provider,
    owned: options.owned,
    usageRole: options.usage_role,
    colorFamily: options.color_family,
  }).map(toSearchRecord);

  return { status: 'ok', items };
}

export async function showPaint({ loadRegistry }, options = {}) {
  const registry = await loadRegistry(options);
  const result = resolvePaint(registry, options.paint, {
    provider: options.provider,
  });

  if (result.status === 'resolved') {
    return { status: 'resolved', item: toPaintRecord(result.paint) };
  }

  return {
    status: result.status,
    matches: (result.matches || []).map(toPaintRecord),
  };
}
