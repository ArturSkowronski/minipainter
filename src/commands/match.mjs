import { matchPaintByColor, matchPaintByDescription } from '../paint-service.mjs';

function parseHexColor(value) {
  const normalized = value.replace('#', '');

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error('Color must be a 6-digit hex value');
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

export async function runMatchCommand(args, context) {
  const [subcommand, ...rest] = args;

  if (subcommand === 'color') {
    const rgb = parseHexColor(rest[0]);
    const result = await matchPaintByColor({ inventoryPath: context.registryPath, rgb });
    return {
      message: 'Color matches',
      items: result.items,
    };
  }

  if (subcommand === 'describe') {
    const result = await matchPaintByDescription({
      inventoryPath: context.registryPath,
      query: rest[0] || '',
    });
    return {
      message: 'Described paint matches',
      items: result.items,
    };
  }

  throw new Error('Unknown match command');
}
