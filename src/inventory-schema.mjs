export function validateInventory(inventory) {
  if (
    !inventory
    || inventory.version !== 1
    || !Array.isArray(inventory.owned)
    || !inventory.owned.every((id) => typeof id === 'string')
  ) {
    throw new Error('invalid inventory shape');
  }
}

export function normalizeInventory(inventory) {
  validateInventory(inventory);
  const owned = [...new Set(inventory.owned)].sort();
  return { version: 1, owned };
}
