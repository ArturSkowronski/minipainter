function jsonReplacer(_key, value) {
  if (value === undefined) {
    return null;
  }

  return value;
}

function isRenderablePaint(item) {
  return item && typeof item.name === 'string' && typeof item.id === 'string';
}

export function renderResult(result, options = {}) {
  if (options.json) {
    return `${JSON.stringify(result, jsonReplacer, 2)}\n`;
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

  return `${lines.join('\n')}\n`;
}
