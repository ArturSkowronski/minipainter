import test from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';

import { initPaintRegistry, markInventoryOwned, listInventory } from '../src/paint-service.mjs';
import { setPoolOverride, resetPool } from '../src/infrastructure/inventory/pg-pool.mjs';

// End-to-end through the same seam every consumer uses: with DATABASE_URL set, the
// whole paint-service persists inventory to Postgres instead of a JSON file.
test('paint-service persists inventory to Postgres when DATABASE_URL is set', async () => {
  const { Pool } = newDb().adapters.createPg();
  setPoolOverride(new Pool());
  const prevUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';

  try {
    const init = await initPaintRegistry({});
    assert.equal(init.created, true);

    const empty = await listInventory({});
    assert.deepEqual(empty.items, []);

    await markInventoryOwned({ paint: 'Abaddon Black' });

    const after = await listInventory({});
    assert.ok(
      after.items.some((item) => item.id === 'citadel/abaddon-black'),
      'owned paint should come back from Postgres',
    );
  } finally {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    await resetPool();
  }
});
