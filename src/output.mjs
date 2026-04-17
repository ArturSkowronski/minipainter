function jsonReplacer(_key, value) {
  if (value === undefined) {
    return null;
  }

  return value;
}

function isRenderablePaint(item) {
  return item && typeof item.name === 'string' && typeof item.id === 'string';
}

function toHex(rgb) {
  if (!rgb) {
    return '';
  }

  const hex = (value) => value.toString(16).padStart(2, '0');
  return `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}`;
}

function formatEquivalentEntry(entry) {
  const { paint, distance } = entry;
  const role = paint.usage_roles?.[0] ?? '';
  const distanceLabel = `≈ ${Math.round(distance)}`;
  return `  - ${paint.name} (${paint.provider})  role: ${role}  ${distanceLabel}  ${toHex(paint.rgb)}`;
}

export function formatEquivalentsText(equivalents, options = {}) {
  if (!equivalents) {
    return '';
  }

  const includeAlternatives = options.includeAlternatives === true;

  if (equivalents.reason === 'source_missing_rgb') {
    return includeAlternatives ? 'No equivalents available (source paint has no rgb).' : '';
  }

  if (equivalents.owned?.length) {
    const lines = ['Equivalents you own:', ...equivalents.owned.map(formatEquivalentEntry)];
    return lines.join('\n');
  }

  if (!includeAlternatives) {
    return '';
  }

  const threshold = equivalents.thresholds?.maxDistance ?? '';
  const header = `Nothing owned qualifies within distance ${threshold}.`;

  if (!equivalents.alternatives?.length) {
    return `${header}\n\nNo close alternatives found either.`;
  }

  const lines = [
    header,
    '',
    'Alternatives:',
    ...equivalents.alternatives.map(formatEquivalentEntry),
  ];
  return lines.join('\n');
}

export function renderResult(result, options = {}) {
  if (options.json) {
    const { equivalents_text: _unused, ...jsonResult } = result;
    return `${JSON.stringify(jsonResult, jsonReplacer, 2)}\n`;
  }

  const lines = [];

  if (result.message) {
    lines.push(result.message);
  }

  if (isRenderablePaint(result.item)) {
    lines.push(`${result.item.name} [${result.item.id}]${result.item.owned ? ' owned' : ''}`);
  }

  if (result.items) {
    lines.push(...result.items
      .filter(isRenderablePaint)
      .map((item) => `${item.name} [${item.id}]${item.owned ? ' owned' : ''}`));
  }

  if (result.equivalents_text) {
    lines.push('', result.equivalents_text);
  }

  return `${lines.join('\n')}\n`;
}
