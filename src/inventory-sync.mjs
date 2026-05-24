import fs from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

import { normalizeInventory } from './inventory-schema.mjs';

async function writeAtomic(targetPath, contents) {
  const tmpPath = `${targetPath}.tmp`;
  await fs.writeFile(tmpPath, contents);
  await fs.rename(tmpPath, targetPath);
}

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function authorized(headers, expectedToken) {
  if (!expectedToken) return false;
  const header = headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return false;
  return safeEqual(header.slice('Bearer '.length), expectedToken);
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
    let normalized;
    try {
      normalized = normalizeInventory(body);
    } catch (error) {
      return { status: 400, body: { error: error.message } };
    }

    await fs.mkdir(path.dirname(context.inventoryPath), { recursive: true });
    await writeAtomic(context.inventoryPath, JSON.stringify(normalized, null, 2));

    if (context.onReload) {
      try {
        await context.onReload();
      } catch (error) {
        return {
          status: 500,
          body: {
            error: 'inventory persisted but registry reload failed; restart the server',
            detail: error.message,
          },
        };
      }
    }

    return { status: 200, body: normalized };
  }

  return { status: 405, body: { error: 'method not allowed' } };
}
