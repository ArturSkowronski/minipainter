/**
 * Predicates over the normalized `product_format` field set by the overlay.
 * This module is the single source of truth for cross-brand equivalence
 * (e.g. Citadel "shade" ≡ AP wash; Citadel "contrast" ≡ AP "speedpaint").
 *
 * Brand-specific roles live on each paint as `usage_roles`. The overlay
 * (data/overrides/product_formats.json) maps those roles into one of:
 *   opaque_base | opaque_layer | wash | contrast | technical | drybrush | metallic
 *
 * Always reason about cross-brand behavior via these predicates, never via
 * `usage_roles` directly.
 */

const OPAQUE = new Set(['opaque_base', 'opaque_layer', 'metallic']);

export function isOpaque(paint) {
  return OPAQUE.has(paint.product_format);
}

export function isTransparentOneCoat(paint) {
  return paint.product_format === 'contrast';
}

export function isWash(paint) {
  return paint.product_format === 'wash';
}

export function isMetallic(paint) {
  return paint.product_format === 'metallic';
}

export function isTechnical(paint) {
  return paint.product_format === 'technical';
}

export function isDrybrush(paint) {
  return paint.product_format === 'drybrush';
}

export function equivalentFormat(a, b) {
  if (!a.product_format || !b.product_format) return false;
  return a.product_format === b.product_format;
}
