import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import {
  getDefaultInventoryPath,
  resolveInventoryPath,
} from '../src/config.mjs';

test('default inventory path lives in the user home .warpaint directory', () => {
  assert.equal(
    getDefaultInventoryPath(),
    path.join(os.homedir(), '.warpaint', 'inventory.json'),
  );
});

test('resolveInventoryPath honours an explicit inventoryPath override', () => {
  assert.equal(
    resolveInventoryPath({ inventoryPath: '/tmp/custom/inv.json' }),
    '/tmp/custom/inv.json',
  );
});

test('resolveInventoryPath uses cwd when provided (test/explicit isolation)', () => {
  assert.equal(
    resolveInventoryPath({ cwd: '/tmp/demo' }),
    '/tmp/demo/.warpaint/inventory.json',
  );
});

test('resolveInventoryPath falls back to home when no overrides are provided', () => {
  assert.equal(
    resolveInventoryPath(),
    path.join(os.homedir(), '.warpaint', 'inventory.json'),
  );
});
