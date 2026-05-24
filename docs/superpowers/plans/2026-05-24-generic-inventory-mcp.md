# Generic Inventory MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace env-var-as-runtime-state with a Fly volume + sync HTTP endpoints + CLI sync command, and remove warpaint branding from the MCP layer.

**Architecture:** `INVENTORY_PATH` env points to a persistent file (Fly volume in container, `~/.warpaint/inventory.json` locally). `INVENTORY_JSON` env becomes a one-time seed. Two new HTTP routes (`GET/POST /inventory`) gated by a bearer token allow remote sync; a `warpaint sync` CLI command drives them from the user's machine. MCP-layer naming becomes env-driven.

**Tech Stack:** Node.js 22, `node:test`, MCP SDK `@modelcontextprotocol/sdk` v1.28, Fly.io volumes.

**Spec:** `docs/superpowers/specs/2026-05-24-generic-inventory-mcp-design.md`

---

## File Structure

**Phase 1 — Persistence layer:**
- Modify: `src/config.mjs` — `INVENTORY_PATH` env support
- Modify: `src/registry-store.mjs` — seed-only env semantics, `saveRegistry` always writes
- Modify: `tests/config.test.mjs`, `tests/registry-store.test.mjs`
- Modify: `fly.toml` — `[mounts]` for `/data`
- Modify: `docs/deploy-fly.md` — `fly volumes create` instructions

**Phase 2 — Sync endpoints:**
- Create: `src/inventory-sync.mjs` — request handler + auth + reload trigger
- Modify: `src/paint-service.mjs` — expose `reloadPaintRegistry`
- Modify: `src/mcp-http-server.mjs` — route `/inventory`
- Create: `tests/inventory-sync.test.mjs`

**Phase 3 — CLI sync:**
- Create: `src/remotes-store.mjs` — `~/.warpaint/remotes.json` IO
- Create: `src/commands/sync.mjs` — `sync push/pull` handlers
- Modify: `src/cli.mjs` — register `sync` command
- Create: `tests/remotes-store.test.mjs`, `tests/sync-command.test.mjs`

**Phase 4 — Branding cleanup:**
- Modify: `src/registry-store.mjs` — accept `INVENTORY_JSON`, alias `WARPAINT_INVENTORY_JSON`
- Modify: `src/mcp-tools.mjs` — `MCP_SERVER_NAME` env (default `paint-inventory`)
- Modify: `src/mcp-server.mjs`, `src/mcp-http-server.mjs` — log strings use server name
- Modify: `README.md` — template fork section

---

## Phase 1 — Persistence Layer

### Task 1.1: `INVENTORY_PATH` env var in config

**Files:**
- Modify: `src/config.mjs`
- Modify: `tests/config.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `tests/config.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/config.test.mjs`
Expected: FAIL — assertions fail because env var is ignored.

- [ ] **Step 3: Update `resolveInventoryPath` in `src/config.mjs`**

Replace the function body so env var has highest precedence after explicit `inventoryPath` option:

```javascript
export function resolveInventoryPath(options = {}) {
  if (options.inventoryPath) return options.inventoryPath;
  if (options.registryPath) return options.registryPath;
  if (process.env.INVENTORY_PATH) return process.env.INVENTORY_PATH;
  if (options.cwd) return path.join(options.cwd, '.warpaint', 'inventory.json');
  return getDefaultInventoryPath();
}
```

Note the order: explicit option > env > cwd > home. This way unit tests using `cwd` still work, but in production deployments env var dominates when no explicit option is passed.

- [ ] **Step 4: Run tests**

Run: `node --test tests/config.test.mjs`
Expected: PASS for both new tests and all pre-existing ones.

Run: `node --test`
Expected: full suite PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/config.mjs tests/config.test.mjs
git commit -m "feat(config): honor INVENTORY_PATH env var for inventory location"
```

---

### Task 1.2: Seed-only semantics for inventory env var

**Files:**
- Modify: `src/registry-store.mjs`
- Modify: `tests/registry-store.test.mjs`

Current behavior (added in earlier work): when `WARPAINT_INVENTORY_JSON` is set, `readInventoryFile` reads from it instead of disk, and `saveRegistry` no-ops. We change to seed semantics: env is used only when the file does not exist; once written, env is ignored on subsequent loads.

- [ ] **Step 1: Write the failing tests**

Add to `tests/registry-store.test.mjs`:

```javascript
test('seeds inventory from INVENTORY_JSON when file is absent, then disk wins', async () => {
  const before = process.env.INVENTORY_JSON;
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, '.warpaint', 'inventory.json');
  const seed = JSON.stringify({ version: 1, owned: ['army_painter/holy-white'] });

  process.env.INVENTORY_JSON = seed;
  try {
    const first = await initRegistryIfMissing(inventoryPath);
    assert.equal(first.created, true);

    const owned = first.registry.catalog.paints.filter((p) => p.owned).map((p) => p.id);
    assert.deepEqual(owned, ['army_painter/holy-white']);

    const onDisk = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
    assert.deepEqual(onDisk, { version: 1, owned: ['army_painter/holy-white'] });

    // Change the env to something else; disk file must win on subsequent load.
    process.env.INVENTORY_JSON = JSON.stringify({ version: 1, owned: [] });
    const second = await loadRegistry(inventoryPath);
    const stillOwned = second.catalog.paints.filter((p) => p.owned).map((p) => p.id);
    assert.deepEqual(stillOwned, ['army_painter/holy-white']);
  } finally {
    if (before === undefined) delete process.env.INVENTORY_JSON;
    else process.env.INVENTORY_JSON = before;
  }
});

test('saveRegistry writes to disk even when INVENTORY_JSON env was used as seed', async () => {
  const before = process.env.INVENTORY_JSON;
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, '.warpaint', 'inventory.json');
  process.env.INVENTORY_JSON = JSON.stringify({ version: 1, owned: [] });
  try {
    const { registry } = await initRegistryIfMissing(inventoryPath);
    const target = registry.catalog.paints.find((p) => p.id === 'army_painter/holy-white');
    assert.ok(target);
    target.owned = true;

    await saveRegistry(inventoryPath, registry);

    const onDisk = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
    assert.deepEqual(onDisk.owned, ['army_painter/holy-white']);
  } finally {
    if (before === undefined) delete process.env.INVENTORY_JSON;
    else process.env.INVENTORY_JSON = before;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/registry-store.test.mjs`
Expected: FAIL — both new tests, because current behavior is: env wins over disk, and save no-ops with env set.

- [ ] **Step 3: Rewrite the env handling in `src/registry-store.mjs`**

Replace `readInventoryFromEnv`, `readInventoryFile`, and `saveRegistry` with seed-aware versions. Also adjust `initRegistryIfMissing` so the seed is the initial content of the file when it doesn't exist. `WARPAINT_INVENTORY_JSON` is kept as an alias so existing deployments are not broken between phases.

```javascript
function readInventoryFromEnv() {
  const raw = process.env.INVENTORY_JSON || process.env.WARPAINT_INVENTORY_JSON;
  if (!raw) return null;
  const inventory = JSON.parse(raw);
  validateInventory(inventory);
  return inventory;
}

async function readInventoryFile(inventoryPath) {
  const raw = await fs.readFile(inventoryPath, 'utf8');
  const inventory = JSON.parse(raw);
  validateInventory(inventory);
  return inventory;
}

export async function saveRegistry(inventoryPath, registry) {
  const owned = registry.catalog.paints
    .filter((paint) => paint.owned)
    .map((paint) => paint.id)
    .sort();

  const inventory = { version: 1, owned };
  validateInventory(inventory);

  await fs.mkdir(path.dirname(inventoryPath), { recursive: true });
  await fs.writeFile(inventoryPath, JSON.stringify(inventory, null, 2));
}
```

Then replace `initRegistryIfMissing` to seed from env when the file is absent:

```javascript
export async function initRegistryIfMissing(inventoryPath) {
  try {
    const registry = await loadRegistry(inventoryPath);
    if (process.env.INVENTORY_JSON) {
      console.warn(
        `warpaint: INVENTORY_JSON env is set but ${inventoryPath} already exists — env ignored, disk is source of truth.`,
      );
    }
    return { created: false, registry };
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error;
    }
  }

  const seeded = readInventoryFromEnv();
  const migrated = seeded ? null : await tryMigrateLegacyRegistry(inventoryPath);
  const owned = seeded ? seeded.owned : (migrated || []);

  await fs.mkdir(path.dirname(inventoryPath), { recursive: true });
  await fs.writeFile(
    inventoryPath,
    JSON.stringify({ version: 1, owned }, null, 2),
  );

  const registry = await loadRegistry(inventoryPath);
  return { created: true, registry, migratedFromLegacy: Boolean(migrated && !seeded) };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/registry-store.test.mjs`
Expected: PASS including new tests.

Run: `node --test`
Expected: full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add src/registry-store.mjs tests/registry-store.test.mjs
git commit -m "feat(registry): seed-only env semantics, disk is source of truth"
```

---

### Task 1.3: Fly volume mount

**Files:**
- Modify: `fly.toml`

- [ ] **Step 1: Edit `fly.toml`**

Add a `[mounts]` block (place it after `[build]`):

```toml
[mounts]
  source = 'inventory_data'
  destination = '/data'
  initial_size = '1'
```

- [ ] **Step 2: Commit**

```bash
git add fly.toml
git commit -m "chore(fly): mount inventory_data volume at /data"
```

Volume creation is operator-side and documented in the next task.

---

### Task 1.4: Document deployment with volume

**Files:**
- Modify: `docs/deploy-fly.md`

- [ ] **Step 1: Append a new section to `docs/deploy-fly.md`**

Add after the existing content:

```markdown
## Persistent Inventory (v2)

Inventory now lives on a Fly volume mounted at `/data`. Before the first deploy
that uses persistent storage, create the volume:

    fly volumes create inventory_data --size 1 --region arn

Pick a single region matching `primary_region` in `fly.toml`. After the volume
exists, deploy normally:

    fly deploy

The container reads `INVENTORY_PATH` (defaults to `/data/inventory.json` in the
Docker image — set via `Dockerfile` ENV). If the file is absent, the server
seeds it from `INVENTORY_JSON` (or the legacy `WARPAINT_INVENTORY_JSON`) on
first boot.

To bootstrap from your local inventory:

    fly secrets set INVENTORY_JSON="$(cat ~/.warpaint/inventory.json)"

After the first boot, the volume is the source of truth — the env var is
ignored on subsequent loads (a warning is logged). Use the sync CLI for
ongoing updates (see `warpaint sync --help`).
```

- [ ] **Step 2: Set the container default for `INVENTORY_PATH`**

Edit `Dockerfile` so the runtime knows to look at `/data`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY data/ ./data/
ENV INVENTORY_PATH=/data/inventory.json
EXPOSE 3000
CMD ["node", "src/mcp-http-server.mjs"]
```

- [ ] **Step 3: Commit**

```bash
git add docs/deploy-fly.md Dockerfile
git commit -m "docs(deploy): document volume bootstrap, default INVENTORY_PATH in image"
```

---

## Phase 2 — Sync Endpoints

### Task 2.1: Expose `reloadPaintRegistry`

**Files:**
- Modify: `src/paint-service.mjs`
- Modify: `tests/paint-service.test.mjs`

The HTTP sync handler needs to drop the cached in-memory registry after a POST. Currently `paint-service.mjs` re-loads on every call via `loadExistingRegistry`, so there is no in-process cache to invalidate. But we want a hook for future caching and a clean way for the sync handler to trigger fresh state explicitly. Implement it as a public `reloadPaintRegistry` that simply calls `initPaintRegistry` again — semantically a no-op today, contract for tomorrow.

- [ ] **Step 1: Write the failing test**

Add to `tests/paint-service.test.mjs`:

```javascript
test('reloadPaintRegistry returns the freshly loaded registry', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'warpaint-'));
  const inventoryPath = path.join(dir, '.warpaint', 'inventory.json');
  await initPaintRegistry({ registryPath: inventoryPath });

  const reloaded = await reloadPaintRegistry({ registryPath: inventoryPath });
  assert.ok(reloaded.registry);
  assert.equal(reloaded.registry.version, 1);
});
```

Also add `reloadPaintRegistry` to the imports at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/paint-service.test.mjs`
Expected: FAIL — `reloadPaintRegistry` is not exported.

- [ ] **Step 3: Add the export in `src/paint-service.mjs`**

Add this export just after `initPaintRegistry`:

```javascript
export async function reloadPaintRegistry(options = {}) {
  const registryPath = getRegistryPath(options);
  const registry = await loadRegistry(registryPath);
  return { registry };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/paint-service.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paint-service.mjs tests/paint-service.test.mjs
git commit -m "feat(paint-service): export reloadPaintRegistry for sync handlers"
```

---

### Task 2.2: Inventory sync HTTP handler

**Files:**
- Create: `src/inventory-sync.mjs`
- Create: `tests/inventory-sync.test.mjs`

Handler is a pure function over a request-like input so we can test without a real HTTP server.

- [ ] **Step 1: Write the failing tests**

Create `tests/inventory-sync.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { handleInventorySync } from '../src/inventory-sync.mjs';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'warpaint-sync-'));
}

function buildContext(overrides = {}) {
  return {
    token: 'secret',
    inventoryPath: overrides.inventoryPath,
    onReload: overrides.onReload || (async () => {}),
  };
}

test('GET returns the current inventory when token matches', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');
  await fs.writeFile(inventoryPath, JSON.stringify({ version: 1, owned: ['army_painter/holy-white'] }));

  const response = await handleInventorySync({
    method: 'GET',
    headers: { authorization: 'Bearer secret' },
    body: null,
    context: buildContext({ inventoryPath }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { version: 1, owned: ['army_painter/holy-white'] });
});

test('POST writes inventory to disk and triggers reload', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');
  let reloadCalls = 0;

  const response = await handleInventorySync({
    method: 'POST',
    headers: { authorization: 'Bearer secret' },
    body: { version: 1, owned: ['citadel/mephiston-red'] },
    context: buildContext({
      inventoryPath,
      onReload: async () => { reloadCalls += 1; },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(reloadCalls, 1);
  const onDisk = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
  assert.deepEqual(onDisk, { version: 1, owned: ['citadel/mephiston-red'] });
});

test('missing or wrong bearer token returns 401', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');

  const noHeader = await handleInventorySync({
    method: 'GET',
    headers: {},
    body: null,
    context: buildContext({ inventoryPath }),
  });
  assert.equal(noHeader.status, 401);

  const wrong = await handleInventorySync({
    method: 'GET',
    headers: { authorization: 'Bearer nope' },
    body: null,
    context: buildContext({ inventoryPath }),
  });
  assert.equal(wrong.status, 401);
});

test('invalid POST body returns 400 and does not write', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');

  const response = await handleInventorySync({
    method: 'POST',
    headers: { authorization: 'Bearer secret' },
    body: { version: 999, owned: 'nope' },
    context: buildContext({ inventoryPath }),
  });

  assert.equal(response.status, 400);
  await assert.rejects(fs.access(inventoryPath));
});

test('sync disabled (no token configured) returns 503', async () => {
  const response = await handleInventorySync({
    method: 'GET',
    headers: { authorization: 'Bearer whatever' },
    body: null,
    context: { token: null, inventoryPath: '/tmp/x' },
  });
  assert.equal(response.status, 503);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/inventory-sync.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the handler**

Create `src/inventory-sync.mjs`:

```javascript
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
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/inventory-sync.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/inventory-sync.mjs tests/inventory-sync.test.mjs
git commit -m "feat(sync): inventory sync handler with bearer-token auth"
```

---

### Task 2.3: Wire `/inventory` into the HTTP server

**Files:**
- Modify: `src/mcp-http-server.mjs`

The existing server only routes `/health` and `/mcp`. Add `/inventory` (GET and POST) by parsing the URL and delegating to `handleInventorySync`. Inject the reload callback as `reloadPaintRegistry`.

- [ ] **Step 1: Edit `src/mcp-http-server.mjs`**

Replace the file body with:

```javascript
#!/usr/bin/env node

import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { resolveInventoryPath } from './config.mjs';
import { initPaintRegistry, reloadPaintRegistry } from './paint-service.mjs';
import { createMcpServer } from './mcp-tools.mjs';
import { handleInventorySync } from './inventory-sync.mjs';

const PORT = process.env.PORT || 3000;
const INVENTORY_PATH = resolveInventoryPath();
const SYNC_TOKEN = process.env.INVENTORY_SYNC_TOKEN || null;

await initPaintRegistry({ registryPath: INVENTORY_PATH });
console.log('Paint registry initialized.');

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return null;
  return JSON.parse(raw);
}

async function handleInventoryRequest(req, res) {
  let body = null;
  if (req.method === 'POST') {
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON body' }));
      return;
    }
  }

  const result = await handleInventorySync({
    method: req.method,
    headers: req.headers,
    body,
    context: {
      token: SYNC_TOKEN,
      inventoryPath: INVENTORY_PATH,
      onReload: async () => { await reloadPaintRegistry({ registryPath: INVENTORY_PATH }); },
    },
  });

  res.writeHead(result.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result.body));
}

async function handleMcpRequest(req, res) {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcpServer = createMcpServer();

  try {
    await mcpServer.connect(transport);
    let parsedBody;
    if (req.method === 'POST') {
      parsedBody = await readJsonBody(req);
    }
    await transport.handleRequest(req, res, parsedBody);
  } catch (err) {
    console.error('MCP request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  } finally {
    await transport.close().catch(() => {});
  }
}

const httpServer = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url === '/inventory') {
    try {
      await handleInventoryRequest(req, res);
    } catch (err) {
      console.error('Inventory sync error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
    return;
  }

  if (req.url === '/mcp') {
    await handleMcpRequest(req, res);
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

httpServer.listen(PORT, () => {
  console.log(`Paint inventory MCP HTTP server on port ${PORT}`);
});
```

- [ ] **Step 2: Manual smoke test locally**

```bash
INVENTORY_SYNC_TOKEN=test-token INVENTORY_PATH=/tmp/inv.json npm run mcp:http &
sleep 1
curl -s http://localhost:3000/health
echo '{"version":1,"owned":["army_painter/holy-white"]}' \
  | curl -s -H 'Authorization: Bearer test-token' -H 'Content-Type: application/json' \
         -d @- http://localhost:3000/inventory
curl -s -H 'Authorization: Bearer test-token' http://localhost:3000/inventory
kill %1
```

Expected: health = `{"status":"ok"}`, POST and GET return the inventory body.

- [ ] **Step 3: Commit**

```bash
git add src/mcp-http-server.mjs
git commit -m "feat(http): route /inventory GET/POST and hot-reload registry"
```

---

## Phase 3 — CLI Sync

### Task 3.1: Remotes store

**Files:**
- Create: `src/remotes-store.mjs`
- Create: `tests/remotes-store.test.mjs`

Stores a list of named remotes (`{ url, token }`) at `~/.warpaint/remotes.json`. Read/write helpers + lookup by name with a `default` fallback.

- [ ] **Step 1: Write the failing tests**

Create `tests/remotes-store.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadRemotes, resolveRemote, saveRemote } from '../src/remotes-store.mjs';

async function makeTempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'warpaint-remotes-'));
  return path.join(dir, 'remotes.json');
}

test('loadRemotes returns empty config when file missing', async () => {
  const file = await makeTempFile();
  const remotes = await loadRemotes(file);
  assert.deepEqual(remotes, { version: 1, remotes: {} });
});

test('saveRemote persists and is readable by loadRemotes', async () => {
  const file = await makeTempFile();
  await saveRemote(file, 'prod', { url: 'https://x.fly.dev', token: 't1' });

  const remotes = await loadRemotes(file);
  assert.deepEqual(remotes.remotes.prod, { url: 'https://x.fly.dev', token: 't1' });
});

test('resolveRemote returns named entry, default, or throws', async () => {
  const file = await makeTempFile();
  await saveRemote(file, 'default', { url: 'https://default.fly.dev', token: 'd' });
  await saveRemote(file, 'prod', { url: 'https://prod.fly.dev', token: 'p' });

  assert.deepEqual(await resolveRemote(file, 'prod'), { url: 'https://prod.fly.dev', token: 'p' });
  assert.deepEqual(await resolveRemote(file, null), { url: 'https://default.fly.dev', token: 'd' });
  await assert.rejects(resolveRemote(file, 'nope'), /unknown remote/);
});

test('resolveRemote accepts a raw URL with no token from remotes file', async () => {
  const file = await makeTempFile();
  const resolved = await resolveRemote(file, 'https://adhoc.fly.dev');
  assert.equal(resolved.url, 'https://adhoc.fly.dev');
  assert.equal(resolved.token, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/remotes-store.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/remotes-store.mjs`**

```javascript
import fs from 'node:fs/promises';
import path from 'node:path';

function isUrlLike(value) {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

export async function loadRemotes(remotesPath) {
  try {
    const raw = await fs.readFile(remotesPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && parsed.remotes && typeof parsed.remotes === 'object') {
      return parsed;
    }
    return { version: 1, remotes: {} };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { version: 1, remotes: {} };
    throw error;
  }
}

export async function saveRemote(remotesPath, name, entry) {
  if (!entry || !entry.url) throw new Error('remote entry requires url');
  const current = await loadRemotes(remotesPath);
  current.remotes[name] = { url: entry.url, token: entry.token || null };
  await fs.mkdir(path.dirname(remotesPath), { recursive: true });
  await fs.writeFile(remotesPath, JSON.stringify(current, null, 2));
}

export async function resolveRemote(remotesPath, nameOrUrl) {
  if (isUrlLike(nameOrUrl)) {
    return { url: nameOrUrl, token: null };
  }
  const remotes = await loadRemotes(remotesPath);
  const key = nameOrUrl || 'default';
  const entry = remotes.remotes[key];
  if (!entry) throw new Error(`unknown remote: ${key}`);
  return entry;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/remotes-store.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remotes-store.mjs tests/remotes-store.test.mjs
git commit -m "feat(remotes): named remotes config at ~/.warpaint/remotes.json"
```

---

### Task 3.2: Sync command

**Files:**
- Create: `src/commands/sync.mjs`
- Create: `tests/sync-command.test.mjs`

Subcommands: `push`, `pull`, `add` (register a remote). Each accepts `--remote <name|url>` and reads token from the resolved remote entry (or from `--token <value>` flag for ad-hoc usage).

- [ ] **Step 1: Write the failing tests**

Create `tests/sync-command.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { runSyncCommand } from '../src/commands/sync.mjs';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'warpaint-sync-cmd-'));
}

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      handler(req, body, res);
    });
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

test('sync push uploads local inventory to the remote', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');
  const remotesPath = path.join(dir, 'remotes.json');
  await fs.writeFile(inventoryPath, JSON.stringify({ version: 1, owned: ['army_painter/holy-white'] }));

  let received = null;
  let receivedAuth = null;
  const { server, port } = await startMockServer((req, body, res) => {
    receivedAuth = req.headers.authorization;
    received = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });

  try {
    const result = await runSyncCommand(
      ['push', '--remote', `http://localhost:${port}`, '--token', 'tk'],
      { inventoryPath, remotesPath },
    );
    assert.equal(result.status, 'pushed');
    assert.equal(receivedAuth, 'Bearer tk');
    assert.deepEqual(received, { version: 1, owned: ['army_painter/holy-white'] });
  } finally {
    server.close();
  }
});

test('sync pull writes remote inventory locally', async () => {
  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, 'inventory.json');
  const remotesPath = path.join(dir, 'remotes.json');

  const { server, port } = await startMockServer((_req, _body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: 1, owned: ['citadel/mephiston-red'] }));
  });

  try {
    const result = await runSyncCommand(
      ['pull', '--remote', `http://localhost:${port}`, '--token', 'tk', '--force'],
      { inventoryPath, remotesPath },
    );
    assert.equal(result.status, 'pulled');

    const onDisk = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
    assert.deepEqual(onDisk, { version: 1, owned: ['citadel/mephiston-red'] });
  } finally {
    server.close();
  }
});

test('sync add registers a remote in remotes.json', async () => {
  const dir = await makeTempDir();
  const remotesPath = path.join(dir, 'remotes.json');

  const result = await runSyncCommand(
    ['add', 'default', '--url', 'https://my.fly.dev', '--token', 'tk'],
    { inventoryPath: path.join(dir, 'inventory.json'), remotesPath },
  );

  assert.equal(result.status, 'added');
  const onDisk = JSON.parse(await fs.readFile(remotesPath, 'utf8'));
  assert.deepEqual(onDisk.remotes.default, { url: 'https://my.fly.dev', token: 'tk' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/sync-command.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/commands/sync.mjs`**

```javascript
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveRemote, saveRemote } from '../remotes-store.mjs';

function parseFlags(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[name] = next;
        i += 1;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function pushInventory({ inventoryPath, remote }) {
  const raw = await fs.readFile(inventoryPath, 'utf8');
  const body = JSON.parse(raw);
  const response = await fetch(`${remote.url.replace(/\/$/, '')}/inventory`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(remote.token ? { Authorization: `Bearer ${remote.token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await readJsonResponse(response).catch(() => null);
    throw new Error(`push failed: ${response.status} ${detail ? JSON.stringify(detail) : ''}`);
  }
  return { status: 'pushed', remote: remote.url, owned: body.owned.length };
}

async function pullInventory({ inventoryPath, remote }) {
  const response = await fetch(`${remote.url.replace(/\/$/, '')}/inventory`, {
    method: 'GET',
    headers: remote.token ? { Authorization: `Bearer ${remote.token}` } : {},
  });
  if (!response.ok) {
    const detail = await readJsonResponse(response).catch(() => null);
    throw new Error(`pull failed: ${response.status} ${detail ? JSON.stringify(detail) : ''}`);
  }
  const body = await readJsonResponse(response);
  await fs.mkdir(path.dirname(inventoryPath), { recursive: true });
  await fs.writeFile(inventoryPath, JSON.stringify(body, null, 2));
  return { status: 'pulled', remote: remote.url, owned: body.owned.length };
}

export async function runSyncCommand(args, context) {
  const [sub, ...rest] = args;
  const { positional, flags } = parseFlags(rest);

  if (sub === 'add') {
    const [name] = positional;
    if (!name) throw new Error('sync add: remote name required');
    if (!flags.url) throw new Error('sync add: --url required');
    await saveRemote(context.remotesPath, name, { url: flags.url, token: flags.token || null });
    return { status: 'added', name, url: flags.url };
  }

  const remote = await resolveRemote(context.remotesPath, flags.remote || null);
  if (flags.token) remote.token = flags.token;

  if (sub === 'push') {
    return pushInventory({ inventoryPath: context.inventoryPath, remote });
  }

  if (sub === 'pull') {
    if (!flags.force) {
      // The CLI wrapper is responsible for interactive confirmation; the
      // command layer treats --force as the explicit go-ahead.
      throw new Error('sync pull requires --force (no interactive prompts at the command layer)');
    }
    return pullInventory({ inventoryPath: context.inventoryPath, remote });
  }

  throw new Error(`unknown sync subcommand: ${sub}`);
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/sync-command.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/sync.mjs tests/sync-command.test.mjs
git commit -m "feat(cli): sync push/pull/add subcommands"
```

---

### Task 3.3: Register `sync` in CLI

**Files:**
- Modify: `src/cli.mjs`
- Modify: `src/config.mjs` (small helper for remotes path)
- Modify: `tests/cli.test.mjs`

- [ ] **Step 1: Add `resolveRemotesPath` helper to `src/config.mjs`**

After `resolveInventoryPath`, append:

```javascript
export function getDefaultRemotesPath() {
  return path.join(os.homedir(), '.warpaint', 'remotes.json');
}

export function resolveRemotesPath(options = {}) {
  if (options.remotesPath) return options.remotesPath;
  if (options.cwd) return path.join(options.cwd, '.warpaint', 'remotes.json');
  return getDefaultRemotesPath();
}
```

- [ ] **Step 2: Write the failing CLI integration test**

Append to `tests/cli.test.mjs`:

```javascript
test('cli routes "sync add" to the sync command', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'warpaint-cli-sync-'));
  const result = await runCli(
    ['sync', 'add', 'default', '--url', 'https://example.fly.dev', '--token', 'tk', '--json'],
    { cwd: dir },
  );
  assert.equal(result.exitCode, 0);
  const remotesFile = path.join(dir, '.warpaint', 'remotes.json');
  const onDisk = JSON.parse(await fs.readFile(remotesFile, 'utf8'));
  assert.deepEqual(onDisk.remotes.default, { url: 'https://example.fly.dev', token: 'tk' });
});
```

(Ensure `fs`/`os`/`path` are imported at the top — they likely already are.)

- [ ] **Step 3: Wire into `src/cli.mjs`**

Add the import and the command:

```javascript
import { resolveRegistryPath, resolveRemotesPath } from './config.mjs';
import { runSyncCommand } from './commands/sync.mjs';

// inside COMMANDS object:
const COMMANDS = {
  catalog: runCatalogCommand,
  paint: runPaintCommand,
  inventory: runInventoryCommand,
  match: runMatchCommand,
  tui: runTuiCommand,
  sync: (args, context) => runSyncCommand(args, {
    inventoryPath: context.registryPath,
    remotesPath: context.remotesPath,
  }),
};
```

And in `runCli`, add `remotesPath` to the context passed to the handler:

```javascript
const result = await handler(rest, {
  cwd,
  registryPath: resolveRegistryPath(options.cwd ? { cwd: options.cwd } : {}),
  remotesPath: resolveRemotesPath(options.cwd ? { cwd: options.cwd } : {}),
});
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/cli.test.mjs`
Expected: PASS, including the new sync test.

Run: `node --test`
Expected: full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.mjs src/config.mjs tests/cli.test.mjs
git commit -m "feat(cli): register sync command and remotes path resolver"
```

---

## Phase 4 — Branding Cleanup

### Task 4.1: Regression test for `WARPAINT_INVENTORY_JSON` alias

**Files:**
- Modify: `tests/registry-store.test.mjs`

The alias was added inline in Task 1.2 to avoid breaking the live deployment. This task locks it in with an explicit regression test so a future refactor can't silently remove it.

- [ ] **Step 1: Write the test**

Append to `tests/registry-store.test.mjs`:

```javascript
test('WARPAINT_INVENTORY_JSON is honored as an alias for INVENTORY_JSON', async () => {
  const beforeNew = process.env.INVENTORY_JSON;
  const beforeOld = process.env.WARPAINT_INVENTORY_JSON;
  delete process.env.INVENTORY_JSON;
  process.env.WARPAINT_INVENTORY_JSON = JSON.stringify({ version: 1, owned: ['army_painter/holy-white'] });

  const dir = await makeTempDir();
  const inventoryPath = path.join(dir, '.warpaint', 'inventory.json');

  try {
    const { registry } = await initRegistryIfMissing(inventoryPath);
    const owned = registry.catalog.paints.filter((p) => p.owned).map((p) => p.id);
    assert.deepEqual(owned, ['army_painter/holy-white']);
  } finally {
    if (beforeNew !== undefined) process.env.INVENTORY_JSON = beforeNew;
    if (beforeOld === undefined) delete process.env.WARPAINT_INVENTORY_JSON;
    else process.env.WARPAINT_INVENTORY_JSON = beforeOld;
  }
});
```

- [ ] **Step 2: Run test**

Run: `node --test tests/registry-store.test.mjs`
Expected: PASS (alias already wired in Task 1.2).

- [ ] **Step 3: Commit**

```bash
git add tests/registry-store.test.mjs
git commit -m "test(registry): pin WARPAINT_INVENTORY_JSON alias behavior"
```

---

### Task 4.2: `MCP_SERVER_NAME` env var

**Files:**
- Modify: `src/mcp-tools.mjs`
- Modify: `tests/mcp-tools.test.mjs`

- [ ] **Step 1: Refactor `createMcpServer` for testability**

Pull the name resolution into a small helper that is exported alongside `createMcpServer`. This lets the test verify the helper directly without depending on internal SDK shape.

In `src/mcp-tools.mjs`:

```javascript
export function resolveMcpServerName() {
  return process.env.MCP_SERVER_NAME || 'paint-inventory';
}

export function createMcpServer(baseOptions = {}) {
  const server = new McpServer({
    name: resolveMcpServerName(),
    version: '0.1.0',
  });
  // ... rest unchanged
}
```

- [ ] **Step 2: Write the test**

Append to `tests/mcp-tools.test.mjs` (also add `resolveMcpServerName` to the import line):

```javascript
test('resolveMcpServerName reads MCP_SERVER_NAME env or defaults to paint-inventory', () => {
  const before = process.env.MCP_SERVER_NAME;
  try {
    delete process.env.MCP_SERVER_NAME;
    assert.equal(resolveMcpServerName(), 'paint-inventory');

    process.env.MCP_SERVER_NAME = 'custom-name';
    assert.equal(resolveMcpServerName(), 'custom-name');
  } finally {
    if (before === undefined) delete process.env.MCP_SERVER_NAME;
    else process.env.MCP_SERVER_NAME = before;
  }
});

test('createMcpServer instantiates without throwing under default and custom names', () => {
  const before = process.env.MCP_SERVER_NAME;
  try {
    delete process.env.MCP_SERVER_NAME;
    assert.doesNotThrow(() => createMcpServer());

    process.env.MCP_SERVER_NAME = 'another-name';
    assert.doesNotThrow(() => createMcpServer());
  } finally {
    if (before === undefined) delete process.env.MCP_SERVER_NAME;
    else process.env.MCP_SERVER_NAME = before;
  }
});
```

- [ ] **Step 3: Run tests**

Run: `node --test tests/mcp-tools.test.mjs`
Expected: PASS — `resolveMcpServerName` returns the right value and `createMcpServer` constructs cleanly under both env states.

Run: `node --test`
Expected: full suite PASS.

- [ ] **Step 4: Commit**

```bash
git add src/mcp-tools.mjs tests/mcp-tools.test.mjs
git commit -m "feat(mcp): MCP_SERVER_NAME env var, default paint-inventory"
```

---

### Task 4.3: Log strings use the server name

**Files:**
- Modify: `src/mcp-server.mjs`
- Modify: `src/mcp-http-server.mjs`

- [ ] **Step 1: Edit `src/mcp-server.mjs`**

Replace the `console.error('Warpaint MCP server error:', error);` line with:

```javascript
const serverName = process.env.MCP_SERVER_NAME || 'paint-inventory';
console.error(`${serverName} MCP server error:`, error);
```

(Move the `serverName` constant just before `main().catch(...)` so it's in scope.)

- [ ] **Step 2: Edit `src/mcp-http-server.mjs`**

The startup log line and the initial "Paint registry initialized." stay generic. Update the listen log to use the server name:

```javascript
const SERVER_NAME = process.env.MCP_SERVER_NAME || 'paint-inventory';
// ...
httpServer.listen(PORT, () => {
  console.log(`${SERVER_NAME} MCP HTTP server on port ${PORT}`);
});
```

- [ ] **Step 3: Manual smoke check**

```bash
MCP_SERVER_NAME=test-name INVENTORY_PATH=/tmp/inv2.json npm run mcp:http &
sleep 1
kill %1
```

Expected log: `test-name MCP HTTP server on port 3000`.

- [ ] **Step 4: Commit**

```bash
git add src/mcp-server.mjs src/mcp-http-server.mjs
git commit -m "chore(mcp): log strings use MCP_SERVER_NAME"
```

---

### Task 4.4: README fork template section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append a new "Self-hosting your own MCP" section to `README.md`**

```markdown
## Self-hosting your own MCP

The MCP server is generic — only the CLI (`warpaint`) is branded. To run your
own instance:

1. Fork or clone the repo.
2. (Optional) rename your Fly app in `fly.toml`.
3. Create a Fly volume and set secrets:

       fly volumes create inventory_data --size 1 --region <your-region>
       fly secrets set INVENTORY_SYNC_TOKEN=$(openssl rand -hex 24)
       # Optional one-time seed:
       fly secrets set INVENTORY_JSON="$(cat ~/.warpaint/inventory.json)"

4. (Optional) name your MCP server:

       fly secrets set MCP_SERVER_NAME=my-paints

5. Deploy:

       fly deploy

6. Register the remote in your local CLI and sync:

       warpaint sync add default --url https://my-app.fly.dev --token <token-from-step-3>
       warpaint sync push

After this, your local inventory and the deployed MCP stay in sync via
`warpaint sync push` / `warpaint sync pull`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): document self-hosting your own MCP instance"
```

---

## Wrap-up

After all four phases:

- [ ] **Final full-suite run**

Run: `node --test`
Expected: full suite PASS, no skipped tests.

- [ ] **Deploy validation**

```bash
fly volumes create inventory_data --size 1 --region arn   # only if not yet created
fly deploy
fly secrets set INVENTORY_SYNC_TOKEN=$(openssl rand -hex 24)
warpaint sync add prod --url https://warpaint-mcp.fly.dev --token <token>
warpaint sync push --remote prod
curl -s -H "Authorization: Bearer <token>" https://warpaint-mcp.fly.dev/inventory \
  | jq '.owned | length'
```

Expected: the same `owned` count as `jq '.owned | length' ~/.warpaint/inventory.json`.

- [ ] **Tag the milestone (optional)**

```bash
git tag -a v0.2.0 -m "Generic inventory MCP with HTTP sync"
git push --tags
```
