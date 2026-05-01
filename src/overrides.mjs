import fs from 'node:fs/promises';

const OVERRIDES_FILE = new URL('../data/overrides/product_formats.json', import.meta.url);

export const PRODUCT_FORMATS = Object.freeze([
  'opaque_base',
  'opaque_layer',
  'wash',
  'contrast',
  'technical',
  'drybrush',
  'metallic',
]);

const PRODUCT_FORMAT_SET = new Set(PRODUCT_FORMATS);

function assertKnownFormat(format, context) {
  if (!PRODUCT_FORMAT_SET.has(format)) {
    throw new Error(`unknown format "${format}" in ${context}`);
  }
}

export function buildOverlay(raw) {
  const rules = (raw.rules || []).map((rule, index) => {
    assertKnownFormat(rule.format, `rules[${index}]`);
    return {
      match: { ...rule.match },
      format: rule.format,
    };
  });

  const overrides = {};
  for (const [paintId, entry] of Object.entries(raw.overrides || {})) {
    assertKnownFormat(entry.format, `overrides["${paintId}"]`);
    overrides[paintId] = { format: entry.format, note: entry.note || null };
  }

  return { rules, overrides };
}

export async function loadOverlay(filePath = OVERRIDES_FILE) {
  const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
  return buildOverlay(raw);
}

function ruleMatches(rule, paint) {
  const { match } = rule;
  if (match.provider && match.provider !== paint.provider) return false;
  if (match.usage_role && !paint.usage_roles.includes(match.usage_role)) return false;
  return true;
}

export function resolveProductFormat(paint, overlay) {
  const override = overlay.overrides[paint.id];
  if (override) {
    return { format: override.format, source: 'override', note: override.note };
  }

  for (const rule of overlay.rules) {
    if (ruleMatches(rule, paint)) {
      return { format: rule.format, source: 'rule', rule };
    }
  }

  return { format: null, source: 'unresolved' };
}

export function enrichPaint(paint, overlay) {
  const { format } = resolveProductFormat(paint, overlay);
  return { ...paint, product_format: format };
}
