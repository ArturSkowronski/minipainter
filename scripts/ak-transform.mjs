import { normalizeText } from '../src/normalize.mjs';

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function hexToRgb(hex) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  if (!match) throw new Error(`invalid hex: ${JSON.stringify(hex)}`);
  const int = parseInt(match[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  let s = 0;
  let h = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

export function classifyColorFamily(rgb) {
  const { h, s, l } = rgbToHsl(rgb);
  if (l < 0.12) return 'black';
  if (l > 0.88 && s < 0.15) return 'white';
  if (s < 0.12) return 'grey';
  if (h < 15) return l > 0.7 ? 'pink' : 'red';
  if (h < 45) return l < 0.4 ? 'brown' : 'orange';
  if (h < 70) return l < 0.35 ? 'brown' : 'yellow';
  if (h < 170) return 'green';
  if (h < 260) return 'blue';
  if (h < 320) return 'purple';
  if (h < 345) return 'pink';
  return l > 0.7 ? 'pink' : 'red';
}

export const TYPE_TO_ROLE = {
  opaque: 'base',
  air: 'air',
  metallic: 'metallic',
  technical: 'technical',
  wash: 'shade',
  contrast: 'contrast',
  ink: 'shade',
};

export function transformCatalog(records) {
  const kept = records.filter((r) => r.type !== 'primer');

  const slugCounts = new Map();
  for (const r of kept) {
    const s = slugify(r.name);
    slugCounts.set(s, (slugCounts.get(s) || 0) + 1);
  }

  const paints = kept.map((r) => {
    const s = slugify(r.name);
    const id = slugCounts.get(s) > 1
      ? `ak_interactive/${s}-${slugify(r.sku)}`
      : `ak_interactive/${s}`;
    return buildPaint(r, id);
  });

  paints.sort((a, b) => a.id.localeCompare(b.id));

  return {
    provider: { id: 'ak_interactive', name: 'AK Interactive' },
    paints,
  };
}

export function buildPaint(source, id) {
  if (!source.name) throw new Error('missing name');
  if (!source.sku) throw new Error('missing sku');
  const role = TYPE_TO_ROLE[source.type];
  if (!role) throw new Error(`unknown ak type: ${JSON.stringify(source.type)}`);
  const rgb = hexToRgb(source.hex);
  const color_families = source.type === 'metallic'
    ? ['metallic']
    : [classifyColorFamily(rgb)];
  return {
    id,
    provider: 'ak_interactive',
    name: source.name,
    normalized_name: normalizeText(source.name),
    aliases: [],
    usage_roles: [role],
    color_families,
    rgb,
    owned: false,
  };
}
