import { listInventory, markInventoryOwned, markInventoryUnowned } from '../paint-service.mjs';

export async function runInventoryCommand(args, context) {
  const [subcommand, ...rest] = args;

  if (subcommand === 'list') {
    const result = await listInventory({ inventoryPath: context.registryPath });
    return {
      message: 'Owned paints',
      items: result.items,
    };
  }

  const query = rest[0];
  const result = subcommand === 'own'
    ? await markInventoryOwned({ inventoryPath: context.registryPath, paint: query })
    : await markInventoryUnowned({ inventoryPath: context.registryPath, paint: query });

  if (result.status === 'updated') {
    return {
      message: `${result.item.name} ownership updated`,
      item: result.item,
    };
  }

  return {
    message: result.status === 'ambiguous' ? 'Paint name is ambiguous' : 'Paint not found',
    items: result.matches,
  };
}
