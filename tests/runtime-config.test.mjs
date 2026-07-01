import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveServerConfig } from '../src/infrastructure/config/runtime-config.mjs';

test('resolveServerConfig derives inventory and remotes paths from DATA_DIR', () => {
  const config = resolveServerConfig({
    DATA_DIR: '/srv/minipainting',
    PORT: '4321',
    AUTH_TOKEN: 'tk',
  });

  assert.equal(config.port, 4321);
  assert.equal(config.dataDir, '/srv/minipainting');
  assert.equal(config.inventoryPath, '/srv/minipainting/inventory.json');
  assert.equal(config.remotesPath, '/srv/minipainting/remotes.json');
  assert.equal(config.authToken, 'tk');
  assert.equal(config.syncToken, 'tk');
});
