# Warpaint Inventory Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first `warpaint` CLI and thin TUI that manage a single-file paint registry with owned-first search and RGB matching.

**Architecture:** Use plain Node.js ESM modules with the built-in test runner. Keep the registry, search engine, CLI parser, and TUI in separate files so the skill-facing search layer remains deterministic and independently testable. Store built-in provider catalogs as local JSON assets and initialize a project-local `.warpaint/registry.json` file from those assets.

**Tech Stack:** Node.js 25, built-in `node:test`, ESM modules, JSON data files, terminal I/O via `readline/promises`

---

## Chunk 1: Project Scaffold and Registry Core

### Task 1: Scaffold the Node CLI project

**Files:**
- Create: `package.json`
- Create: `src/cli.mjs`
- Create: `src/config.mjs`
- Create: `tests/config.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultRegistryPath } from '../src/config.mjs';

test('default registry path lives in project-local .warpaint directory', () => {
  assert.match(getDefaultRegistryPath('/tmp/demo'), /\/tmp\/demo\/\.warpaint\/registry\.json$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/config.test.mjs`
Expected: FAIL with module or export missing

- [ ] **Step 3: Write minimal implementation**

```js
export function getDefaultRegistryPath(cwd = process.cwd()) {
  return new URL('.warpaint/registry.json', `file://${cwd.replace(/\/$/, '')}/`).pathname;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/config.test.mjs`
Expected: PASS

- [ ] **Step 5: Add executable package metadata**

Add a `package.json` with:
- `"type": "module"`
- `"bin": { "warpaint": "./src/cli.mjs" }`
- `"scripts": { "test": "node --test" }`

- [ ] **Step 6: Commit**

```bash
git add package.json src/config.mjs src/cli.mjs tests/config.test.mjs
git commit -m "feat: scaffold warpaint node cli"
```

### Task 2: Add built-in provider catalog assets and registry load/save logic

**Files:**
- Create: `data/catalog/citadel.json`
- Create: `data/catalog/army_painter.json`
- Create: `src/catalog-data.mjs`
- Create: `src/registry-store.mjs`
- Create: `tests/registry-store.test.mjs`

- [ ] **Step 1: Write the failing tests**

Cover:
- loading built-in provider data
- initializing a missing registry from built-in catalogs
- persisting owned state
- rejecting malformed registry shape

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/registry-store.test.mjs`
Expected: FAIL with missing modules/functions

- [ ] **Step 3: Write minimal implementation**

Create focused modules:
- `src/catalog-data.mjs`: reads built-in provider JSON assets
- `src/registry-store.mjs`: `loadRegistry`, `saveRegistry`, `initRegistryIfMissing`, schema validation

Catalog asset requirements:
- include Citadel and Army Painter starter catalogs with normalized records
- every paint has `id`, `provider`, `name`, `normalized_name`, `aliases`, `usage_roles`, `color_families`, `rgb`, `owned`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/registry-store.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add data/catalog src/catalog-data.mjs src/registry-store.mjs tests/registry-store.test.mjs
git commit -m "feat: add registry storage and built-in catalogs"
```

## Chunk 2: Search Engine and Inventory Mutations

### Task 3: Implement deterministic search and matching engine

**Files:**
- Create: `src/normalize.mjs`
- Create: `src/search-engine.mjs`
- Create: `tests/search-engine.test.mjs`

- [ ] **Step 1: Write the failing tests**

Cover:
- exact name match
- alias match
- owned-first ordering
- provider filter
- usage-role filter
- color-family filter
- RGB nearest-neighbor ranking
- ambiguous name detection

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/search-engine.test.mjs`
Expected: FAIL with missing search functions

- [ ] **Step 3: Write minimal implementation**

Implement:
- `normalizeText(value)`
- `searchPaints(registry, query, options)`
- `resolvePaint(registry, query, options)`
- `matchByColor(registry, rgb, options)`

Keep ranking rules aligned with the spec:
- exact or alias hits first
- owned paints before non-owned for similar relevance
- filters narrow before fuzzy fallback
- RGB distance used only for color matching

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/search-engine.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/normalize.mjs src/search-engine.mjs tests/search-engine.test.mjs
git commit -m "feat: add paint search and color matching"
```

### Task 4: Implement inventory ownership updates

**Files:**
- Create: `src/inventory-service.mjs`
- Create: `tests/inventory-service.test.mjs`
- Modify: `src/registry-store.mjs`

- [ ] **Step 1: Write the failing tests**

Cover:
- mark paint owned by name
- mark paint not owned
- ambiguous name update returns disambiguation
- unknown paint returns close matches

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/inventory-service.test.mjs`
Expected: FAIL with missing inventory service

- [ ] **Step 3: Write minimal implementation**

Implement:
- `markOwned(registry, query, options)`
- `markUnowned(registry, query, options)`
- result objects that include status, resolved paint, or disambiguation candidates

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/inventory-service.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/inventory-service.mjs src/registry-store.mjs tests/inventory-service.test.mjs
git commit -m "feat: add inventory ownership service"
```

## Chunk 3: CLI, TUI, and End-to-End Verification

### Task 5: Implement the CLI command surface

**Files:**
- Create: `src/output.mjs`
- Create: `src/commands/catalog.mjs`
- Create: `src/commands/paint.mjs`
- Create: `src/commands/inventory.mjs`
- Create: `src/commands/match.mjs`
- Modify: `src/cli.mjs`
- Create: `tests/cli.test.mjs`

- [ ] **Step 1: Write the failing tests**

Cover:
- `catalog sync`
- `paint search`
- `paint show`
- `inventory own`
- `inventory unown`
- `inventory list`
- `match color`
- `match describe`
- JSON output mode

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/cli.test.mjs`
Expected: FAIL with command parsing not implemented

- [ ] **Step 3: Write minimal implementation**

Implement a small parser in `src/cli.mjs` and keep command handlers isolated per command family. Use structured return objects that can be rendered as human-readable text or JSON.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/cli.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli.mjs src/output.mjs src/commands tests/cli.test.mjs
git commit -m "feat: add warpaint command surface"
```

### Task 6: Add the thin interactive TUI

**Files:**
- Create: `src/tui.mjs`
- Modify: `src/commands/paint.mjs`
- Modify: `src/commands/inventory.mjs`
- Modify: `src/cli.mjs`
- Create: `tests/tui.test.mjs`

- [ ] **Step 1: Write the failing tests**

Cover:
- catalog view search and filter state
- owned toggle flow
- detail view rendering model through pure state helpers

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/tui.test.mjs`
Expected: FAIL with missing TUI state helpers

- [ ] **Step 3: Write minimal implementation**

Implement a readline-based TUI with:
- catalog view
- owned view
- paint detail panel
- filter controls
- ownership toggle shortcut

Keep state derivation and rendering helpers separate from terminal I/O so the logic is testable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/tui.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui.mjs src/cli.mjs tests/tui.test.mjs
git commit -m "feat: add interactive paint inventory tui"
```

### Task 7: Final integration verification and docs

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-03-30-warpaint-inventory-design.md`

- [ ] **Step 1: Write documentation**

Document:
- registry file location
- command examples
- TUI entrypoint
- limitation that built-in catalogs are local assets

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 3: Smoke-test the CLI manually**

Run:
- `node src/cli.mjs catalog sync`
- `node src/cli.mjs paint search black`
- `node src/cli.mjs inventory own "Abaddon Black"`
- `node src/cli.mjs inventory list`

Expected:
- registry file created
- search returns matching paint
- ownership update succeeds
- owned list shows the paint

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-03-30-warpaint-inventory-design.md
git commit -m "docs: add warpaint usage guidance"
```
