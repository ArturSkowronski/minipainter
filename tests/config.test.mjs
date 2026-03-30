import test from 'node:test';
import assert from 'node:assert/strict';

import { getDefaultRegistryPath } from '../src/config.mjs';

test('default registry path lives in project-local .warpaint directory', () => {
  assert.match(
    getDefaultRegistryPath('/tmp/demo'),
    /\/tmp\/demo\/\.warpaint\/registry\.json$/,
  );
});
