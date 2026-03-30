import { normalizeText } from './normalize.mjs';

function matchesFilters(paint, options = {}) {
  if (options.provider && paint.provider !== options.provider) {
    return false;
  }

  if (options.owned !== undefined && paint.owned !== options.owned) {
    return false;
  }

  if (options.usageRole && !paint.usage_roles.includes(options.usageRole)) {
    return false;
  }

  if (options.colorFamily && !paint.color_families.includes(options.colorFamily)) {
    return false;
  }

  return true;
}

function scorePaint(paint, query) {
  if (!query) {
    return 10;
  }

  if (paint.normalized_name === query) {
    return 100;
  }

  if (paint.aliases.some((alias) => normalizeText(alias) === query)) {
    return 95;
  }

  if (paint.normalized_name.includes(query)) {
    return 80;
  }

  if (paint.aliases.some((alias) => normalizeText(alias).includes(query))) {
    return 75;
  }

  const families = paint.color_families.map((family) => normalizeText(family));
  if (families.includes(query)) {
    return 60;
  }

  const roles = paint.usage_roles.map((role) => normalizeText(role));
  if (roles.includes(query)) {
    return 55;
  }

  return -1;
}

function compareSearchResults(left, right) {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  if (left.paint.owned !== right.paint.owned) {
    return left.paint.owned ? -1 : 1;
  }

  return left.paint.name.localeCompare(right.paint.name);
}

export function searchPaints(registry, query, options = {}) {
  const normalizedQuery = normalizeText(query);

  return registry.catalog.paints
    .filter((paint) => matchesFilters(paint, options))
    .map((paint) => ({
      paint,
      score: scorePaint(paint, normalizedQuery),
    }))
    .filter((result) => result.score >= 0)
    .sort(compareSearchResults);
}

export function resolvePaint(registry, query, options = {}) {
  const results = searchPaints(registry, query, options);

  if (results.length === 0) {
    return { status: 'not_found', matches: [] };
  }

  const normalizedQuery = normalizeText(query);
  const exactMatches = results.filter((result) => result.score >= 95
    || result.paint.normalized_name === normalizedQuery);

  if (exactMatches.length > 1) {
    return {
      status: 'ambiguous',
      matches: exactMatches.map((result) => result.paint),
    };
  }

  return {
    status: 'resolved',
    paint: (exactMatches[0] || results[0]).paint,
  };
}

function colorDistance(left, right) {
  return Math.sqrt(
    ((left.r - right.r) ** 2)
      + ((left.g - right.g) ** 2)
      + ((left.b - right.b) ** 2),
  );
}

export function matchByColor(registry, rgb, options = {}) {
  return registry.catalog.paints
    .filter((paint) => matchesFilters(paint, options))
    .map((paint) => ({
      paint,
      distance: colorDistance(paint.rgb, rgb),
    }))
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      if (left.paint.owned !== right.paint.owned) {
        return left.paint.owned ? -1 : 1;
      }

      return left.paint.name.localeCompare(right.paint.name);
    });
}
