// Pure transform: Games Workshop "Warhammer Tone Pro" range -> our catalog schema.
// Source: scripts/warhammer-tone-pro.source.json (hand-curated; hobby-desk-data
// predates the range — see the provenance block in that file).
//
// The range is 30 colour families, each sold as five numbered tones
// (1 = darkest … 5 = lightest), so one family yields five paints:
// `citadel/<family-slug>-<tone>` named "<Family> <tone>", exactly as the pots
// are labelled. The paints are opaque layer paints (GW markets them for base,
// layer, highlight, glaze and drybrush), so they carry the `layer` role, which
// the citadel overlay rule resolves to `opaque_layer`.
import { slugify, hexToRgb, classifyColorFamily } from './ak-transform.mjs';
import { normalizeText } from '../src/normalize.mjs';

export const TONES_PER_FAMILY = 5;

export function tonePaintId(familyName, tone) {
  return `citadel/${slugify(familyName)}-${tone}`;
}

export function buildTonePaint(familyName, tone, hex) {
  const name = `${familyName} ${tone}`;
  const rgb = hexToRgb(hex);
  return {
    id: tonePaintId(familyName, tone),
    provider: 'citadel',
    name,
    normalized_name: normalizeText(name),
    // "Ta’unar" normalizes to "ta unar"; people type "taunar", so add an
    // apostrophe-free spelling too.
    aliases: [`Tone Pro ${name}`, ...(/['’]/.test(name) ? [name.replace(/['’]/g, '')] : [])],
    usage_roles: ['layer'],
    color_families: [classifyColorFamily(rgb)],
    rgb,
    owned: false,
  };
}

// `existingIds` are ids already in the citadel catalog (excluding a previous
// Tone Pro import). Tone Pro names are unique within GW's line-up, so a
// collision means the source or the catalog is wrong — fail loudly instead of
// silently suffixing.
export function transformTonePro(families, existingIds = new Set()) {
  const paints = [];
  for (const family of families) {
    if (!family.name) throw new Error('family without a name');
    if (!Array.isArray(family.tones) || family.tones.length !== TONES_PER_FAMILY) {
      throw new Error(`${family.name}: expected ${TONES_PER_FAMILY} tones`);
    }
    family.tones.forEach((hex, index) => {
      const paint = buildTonePaint(family.name, index + 1, hex);
      if (existingIds.has(paint.id)) throw new Error(`id collision: ${paint.id}`);
      paints.push(paint);
    });
  }
  return paints;
}
