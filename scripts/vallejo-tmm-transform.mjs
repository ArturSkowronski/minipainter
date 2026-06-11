// Pure transform: Vallejo "True Metallic Metal" range (hobby-desk-data) -> our catalog schema.
// Source upstream: alexparlett/hobby-desk-data, vallejo/vallejo_true_metallic_metal.json
// Pinned commit: 1bc4e09 (same pin as the AK import).
//
// The upstream file lists each of the 20 colours four times (one block per pack SKU,
// e.g. Imperial Gold appears as 77.103 / 77.123 / 77.143 / 77.163 with drifting hex).
// We deduplicate by name, keeping the record with the smallest SKU (the canonical
// 77.10x block), which matches each colour's product page.
import { slugify, hexToRgb, classifyColorFamily } from './ak-transform.mjs';
import { normalizeText } from '../src/normalize.mjs';

export function dedupeBySku(records) {
  const byName = new Map();
  for (const r of records) {
    if (!r.name) throw new Error('missing name');
    if (!r.sku) throw new Error(`missing sku for ${JSON.stringify(r.name)}`);
    const current = byName.get(r.name);
    if (!current || String(r.sku) < String(current.sku)) byName.set(r.name, r);
  }
  return [...byName.values()];
}

export function buildVallejoMetallicPaint(source, takenIds) {
  const rgb = hexToRgb(source.hex);
  const slug = slugify(source.name);
  const base = `vallejo/${slug}`;
  const id = takenIds.has(base) ? `vallejo/${slug}-${slugify(source.sku)}` : base;
  return {
    id,
    provider: 'vallejo',
    name: source.name,
    normalized_name: normalizeText(source.name),
    aliases: [],
    usage_roles: ['metallic'],
    color_families: ['metallic', classifyColorFamily(rgb)],
    rgb,
    owned: false,
  };
}

// `existingIds` are the ids already present in the catalog that this range must not
// collide with (the pre-existing Vallejo Game Color ids). Colliding names get a
// `-<sku>` suffix, mirroring the AK import's disambiguation.
export function transformTmm(records, existingIds = new Set()) {
  const taken = new Set(existingIds);
  const paints = [];
  for (const record of dedupeBySku(records)) {
    const paint = buildVallejoMetallicPaint(record, taken);
    taken.add(paint.id);
    paints.push(paint);
  }
  paints.sort((a, b) => a.id.localeCompare(b.id));
  return paints;
}
