// Pure transform: Vallejo "Game Color Ink" range -> our catalog schema.
// Source: scripts/vallejo-game-inks.source.json (hand-curated; hobby-desk-data
// carries no Game Ink line — see the provenance block in that file).
//
// Inks get the `ink` usage role, which the overlay resolves to the `ink`
// product_format (transparent, high-pigment glaze medium; not a wash and not
// a contrast paint).
import { slugify, hexToRgb, classifyColorFamily } from './ak-transform.mjs';
import { normalizeText } from '../src/normalize.mjs';

export function buildVallejoInkPaint(source, takenIds = new Set()) {
  if (!source.name) throw new Error('missing name');
  if (!source.sku) throw new Error(`missing sku for ${JSON.stringify(source.name)}`);
  const rgb = hexToRgb(source.hex);
  const slug = slugify(source.name);
  const base = `vallejo/${slug}`;
  const id = takenIds.has(base) ? `vallejo/${slug}-${slugify(source.sku)}` : base;
  return {
    id,
    provider: 'vallejo',
    name: source.name,
    normalized_name: normalizeText(source.name),
    aliases: source.aliases ? [...source.aliases] : [],
    usage_roles: ['ink'],
    color_families: [classifyColorFamily(rgb)],
    rgb,
    owned: false,
  };
}

// `existingIds` are the ids already present in the catalog that this range must
// not collide with. Colliding names get a `-<sku>` suffix, mirroring the AK and
// True Metallic Metal imports' disambiguation.
export function transformInks(records, existingIds = new Set()) {
  const taken = new Set(existingIds);
  const paints = [];
  for (const record of records) {
    const paint = buildVallejoInkPaint(record, taken);
    taken.add(paint.id);
    paints.push(paint);
  }
  paints.sort((a, b) => a.id.localeCompare(b.id));
  return paints;
}
