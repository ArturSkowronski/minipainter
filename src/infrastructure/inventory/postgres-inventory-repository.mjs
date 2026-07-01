import { normalizeInventory, validateInventory } from '../../inventory-schema.mjs';

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS owned_paints (
    paint_id   text PRIMARY KEY,
    added_at   timestamptz NOT NULL DEFAULT now()
  )
`;

function readInventoryFromEnv() {
  const raw = process.env.INVENTORY_JSON || process.env.WARPAINT_INVENTORY_JSON;
  if (!raw) return null;
  const inventory = JSON.parse(raw);
  validateInventory(inventory);
  return inventory;
}

async function tableExists(pool) {
  try {
    await pool.query('SELECT 1 FROM owned_paints LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

const ensuredPools = new WeakSet();

async function ensureTable(pool) {
  if (ensuredPools.has(pool)) return;
  await pool.query(CREATE_TABLE);
  ensuredPools.add(pool);
}

async function loadOwned(pool) {
  const { rows } = await pool.query('SELECT paint_id FROM owned_paints ORDER BY paint_id ASC');
  return rows.map((row) => row.paint_id);
}

async function replaceOwned(client, owned) {
  // owned is already de-duplicated by normalizeInventory, and we clear the table
  // first, so a plain insert cannot collide.
  await client.query('DELETE FROM owned_paints');
  for (const id of owned) {
    await client.query('INSERT INTO owned_paints (paint_id) VALUES ($1)', [id]);
  }
}

async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function createPostgresInventoryRepository({ pool }) {
  if (!pool) throw new Error('postgres inventory repository requires a pool');

  return {
    async load() {
      return normalizeInventory({ version: 1, owned: await loadOwned(pool) });
    },

    async save(inventory) {
      const normalized = normalizeInventory(inventory);
      await ensureTable(pool);
      await inTransaction(pool, (client) => replaceOwned(client, normalized.owned));
      return normalized;
    },

    async initIfMissing() {
      const existed = await tableExists(pool);
      await ensureTable(pool);

      const owned = await loadOwned(pool);
      if (owned.length > 0) {
        if (process.env.INVENTORY_JSON || process.env.WARPAINT_INVENTORY_JSON) {
          console.warn(
            'warpaint: INVENTORY_JSON is set but the database already has an inventory — env ignored, the database is source of truth.',
          );
        }
        return { created: false, inventory: normalizeInventory({ version: 1, owned }) };
      }

      const seeded = readInventoryFromEnv();
      const inventory = normalizeInventory({ version: 1, owned: seeded ? seeded.owned : [] });
      if (inventory.owned.length > 0) {
        await inTransaction(pool, (client) => replaceOwned(client, inventory.owned));
      }
      return { created: !existed, inventory };
    },

    async mutate(mutator) {
      await ensureTable(pool);
      return inTransaction(pool, async (client) => {
        const { rows } = await client.query('SELECT paint_id FROM owned_paints ORDER BY paint_id ASC FOR UPDATE');
        const current = normalizeInventory({ version: 1, owned: rows.map((row) => row.paint_id) });
        const next = normalizeInventory(await mutator(current));
        await replaceOwned(client, next.owned);
        return next;
      });
    },
  };
}
