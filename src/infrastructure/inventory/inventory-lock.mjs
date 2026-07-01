const pendingByKey = new Map();

export async function withInventoryLock(key, fn) {
  const previous = pendingByKey.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });

  pendingByKey.set(key, previous.finally(() => current));
  await previous;

  try {
    return await fn();
  } finally {
    release();
    if (pendingByKey.get(key) === current) {
      pendingByKey.delete(key);
    }
  }
}
