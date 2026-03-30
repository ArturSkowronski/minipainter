function jsonReplacer(_key, value) {
  if (value === undefined) {
    return null;
  }

  return value;
}

export function renderResult(result, options = {}) {
  if (options.json) {
    return `${JSON.stringify(result, jsonReplacer, 2)}\n`;
  }

  if (result.message) {
    return `${result.message}\n`;
  }

  if (result.item) {
    return `${result.item.name} [${result.item.id}]${result.item.owned ? ' owned' : ''}\n`;
  }

  if (result.items) {
    return `${result.items.map((item) => `${item.name} [${item.id}]`).join('\n')}\n`;
  }

  return '\n';
}
