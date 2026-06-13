// Pure transform: Vallejo brush-on varnishes (hobby-desk-data) -> our catalog schema.
// Source upstream: alexparlett/hobby-desk-data, vallejo/vallejo_premium_color.json
// Pinned commit: 1bc4e09 (same pin as the AK and True Metallic Metal imports).
//
// The pre-existing Vallejo mirror carries no auxiliary/varnish products. The Premium
// Color line holds the three general-purpose brush-on acrylic varnishes
// (Matt 62.062 / Satin 62.063 / Gloss 62.064), whose plain names match how painters
// refer to them. They are clear media (upstream hex #FFFFFF), so they classify into
// the `white` colour family and carry the `technical` usage role, which the overlay
// resolves to the `technical` product_format.
import { slugify, hexToRgb, classifyColorFamily } from './ak-transform.mjs';
import { normalizeText } from '../src/normalize.mjs';

export function buildVallejoVarnishPaint(source, takenIds = new Set()) {
  if (!source.name) throw new Error('missing name');
  if (!source.sku) throw new Error(`missing sku for ${JSON.stringify(source.name)}`);
  if (source.type !== 'varnish') {
    throw new Error(`expected type "varnish", got ${JSON.stringify(source.type)} for ${source.name}`);
  }
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
    usage_roles: ['technical'],
    color_families: [classifyColorFamily(rgb)],
    rgb,
    owned: false,
  };
}

// `existingIds` are the ids already present in the catalog that this range must not
// collide with. Colliding names get a `-<sku>` suffix, mirroring the AK / TMM imports.
export function transformVarnish(records, existingIds = new Set()) {
  const taken = new Set(existingIds);
  const paints = [];
  for (const record of records) {
    const paint = buildVallejoVarnishPaint(record, taken);
    taken.add(paint.id);
    paints.push(paint);
  }
  paints.sort((a, b) => a.id.localeCompare(b.id));
  return paints;
}
