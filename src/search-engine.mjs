import { normalizeText } from './normalize.mjs';

function levenshteinDistance(left, right) {
  const rows = Array.from({ length: left.length + 1 }, () => []);

  for (let row = 0; row <= left.length; row += 1) {
    rows[row][0] = row;
  }

  for (let column = 0; column <= right.length; column += 1) {
    rows[0][column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + cost,
      );
    }
  }

  return rows[left.length][right.length];
}

function isFuzzyTokenMatch(paint, query) {
  if (!query || query.length < 5) {
    return false;
  }

  const candidates = [
    ...paint.normalized_name.split(' '),
    ...paint.aliases.flatMap((alias) => normalizeText(alias).split(' ')),
    ...paint.color_families.map((family) => normalizeText(family)),
    ...paint.usage_roles.map((role) => normalizeText(role)),
  ].filter(Boolean);

  return candidates.some((candidate) => candidate.length >= 5
    && levenshteinDistance(candidate, query) <= 2);
}

// Substring matching must start at a word boundary: "ink" matches "green ink"
// but not "squid pink". Query tokens may still be prefixes ("pall" -> "pallid").
function matchesAtWordBoundary(text, query) {
  return ` ${text}`.includes(` ${query}`);
}

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

  if (matchesAtWordBoundary(paint.normalized_name, query)) {
    return 80;
  }

  if (paint.aliases.some((alias) => matchesAtWordBoundary(normalizeText(alias), query))) {
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

  if (paint.product_format && normalizeText(paint.product_format) === query) {
    return 50;
  }

  if (isFuzzyTokenMatch(paint, query)) {
    return 40;
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
  const exactById = registry.catalog.paints.find((paint) => paint.id === query);
  if (exactById && (!options.provider || exactById.provider === options.provider)) {
    return { status: 'resolved', paint: exactById };
  }

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

  if (exactMatches.length === 0) {
    return {
      status: 'not_found',
      matches: results.slice(0, 5).map((result) => result.paint),
    };
  }

  return {
    status: 'resolved',
    paint: exactMatches[0].paint,
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
