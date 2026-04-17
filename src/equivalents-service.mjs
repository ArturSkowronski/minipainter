import { colorDistance, resolvePaint } from './search-engine.mjs';
import { rolesMatch } from './roles.mjs';

const DEFAULT_MAX_DISTANCE = 60;
const DEFAULT_LIMIT = 3;

function resolveSource(registry, paintRef) {
  if (paintRef && typeof paintRef === 'object') {
    return { status: 'resolved', paint: paintRef };
  }

  return resolvePaint(registry, paintRef);
}

function rolesOverlap(source, candidate) {
  return source.usage_roles.some((sourceRole) => candidate.usage_roles.some(
    (candidateRole) => rolesMatch(sourceRole, candidateRole),
  ));
}

function rankCandidates(candidates, maxDistance, limit) {
  return candidates
    .filter((entry) => entry.distance <= maxDistance)
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      return left.paint.name.localeCompare(right.paint.name);
    })
    .slice(0, limit);
}

export function findEquivalents(registry, paintRef, options = {}) {
  const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const includeSameProvider = options.includeSameProvider === true;

  const resolution = resolveSource(registry, paintRef);

  if (resolution.status !== 'resolved') {
    return resolution;
  }

  const source = resolution.paint;
  const thresholds = { maxDistance, limit, includeSameProvider };

  if (!source.rgb) {
    return {
      source,
      owned: [],
      alternatives: [],
      thresholds,
      reason: 'source_missing_rgb',
    };
  }

  const scored = registry.catalog.paints
    .filter((paint) => paint.id !== source.id)
    .filter((paint) => includeSameProvider || paint.provider !== source.provider)
    .filter((paint) => rolesOverlap(source, paint))
    .map((paint) => ({ paint, distance: colorDistance(source.rgb, paint.rgb) }));

  const owned = rankCandidates(scored.filter((entry) => entry.paint.owned), maxDistance, limit);
  const alternatives = owned.length > 0
    ? []
    : rankCandidates(scored.filter((entry) => !entry.paint.owned), maxDistance, limit);

  return { source, owned, alternatives, thresholds };
}
