import fs from 'node:fs/promises';
import path from 'node:path';

function validateInventory(inventory) {
  if (
    !inventory
    || inventory.version !== 1
    || !Array.isArray(inventory.owned)
    || !inventory.owned.every((id) => typeof id === 'string')
  ) {
    throw new Error('invalid inventory shape');
  }
}

function authorized(headers, expectedToken) {
  if (!expectedToken) return false;
  const header = headers.authorization || headers.Authorization;
  if (!header || !header.startsWith('Bearer ')) return false;
  return header.slice('Bearer '.length) === expectedToken;
}

export async function handleInventorySync({ method, headers = {}, body, context }) {
  if (!context.token) {
    return { status: 503, body: { error: 'sync disabled (no INVENTORY_SYNC_TOKEN)' } };
  }

  if (!authorized(headers, context.token)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  if (method === 'GET') {
    try {
      const raw = await fs.readFile(context.inventoryPath, 'utf8');
      return { status: 200, body: JSON.parse(raw) };
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { status: 200, body: { version: 1, owned: [] } };
      }
      throw error;
    }
  }

  if (method === 'POST') {
    try {
      validateInventory(body);
    } catch (error) {
      return { status: 400, body: { error: error.message } };
    }
    await fs.mkdir(path.dirname(context.inventoryPath), { recursive: true });
    await fs.writeFile(context.inventoryPath, JSON.stringify(body, null, 2));
    if (context.onReload) await context.onReload();
    return { status: 200, body };
  }

  return { status: 405, body: { error: 'method not allowed' } };
}
