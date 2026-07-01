import { searchPaintCatalog, showPaint } from '../paint-service.mjs';

export async function runPaintCommand(args, context) {
  const [subcommand, ...rest] = args;

  if (subcommand === 'search') {
    const query = rest[0] || '';
    const result = await searchPaintCatalog({ inventoryPath: context.registryPath, query });
    return {
      message: `Found ${result.items.length} paint matches`,
      items: result.items,
    };
  }

  if (subcommand === 'show') {
    const query = rest[0];
    const result = await showPaint({ inventoryPath: context.registryPath, paint: query });

    if (result.status !== 'resolved') {
      return {
        message: 'Paint could not be resolved',
        item: null,
        items: result.matches || [],
      };
    }

    return {
      message: `Showing ${result.item.name}`,
      item: result.item,
    };
  }

  throw new Error('Unknown paint command');
}
