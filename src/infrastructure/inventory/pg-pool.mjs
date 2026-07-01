import pg from 'pg';

// Lazy singleton pool. A pg.Pool is meant to be long-lived and shared, so we create
// one per process from DATABASE_URL. Tests inject an in-memory pool via setPoolOverride.
let pool = null;
let override = null;

export function getPool() {
  if (override) return override;
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new pg.Pool({ connectionString });
  }
  return pool;
}

export function setPoolOverride(testPool) {
  override = testPool;
}

export async function resetPool() {
  override = null;
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
}
