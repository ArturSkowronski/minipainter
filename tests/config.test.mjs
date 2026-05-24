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

test('resolveInventoryPath honors INVENTORY_PATH env var over defaults', () => {
  const before = process.env.INVENTORY_PATH;
  process.env.INVENTORY_PATH = '/custom/inv.json';
  try {
    assert.equal(resolveInventoryPath(), '/custom/inv.json');
    assert.equal(resolveInventoryPath({ cwd: '/tmp/foo' }), '/custom/inv.json');
  } finally {
    if (before === undefined) delete process.env.INVENTORY_PATH;
    else process.env.INVENTORY_PATH = before;
  }
});

test('resolveInventoryPath falls back to inventoryPath option, then cwd, then home', () => {
  const before = process.env.INVENTORY_PATH;
  delete process.env.INVENTORY_PATH;
  try {
    assert.equal(resolveInventoryPath({ inventoryPath: '/explicit' }), '/explicit');
    assert.equal(resolveInventoryPath({ cwd: '/tmp/foo' }), '/tmp/foo/.warpaint/inventory.json');
    assert.ok(resolveInventoryPath().endsWith('/.warpaint/inventory.json'));
  } finally {
    if (before !== undefined) process.env.INVENTORY_PATH = before;
  }
});
