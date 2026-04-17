# Warpaint Cross-Provider Equivalents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user is told about a paint from another brand, surface the closest owned substitute from their local inventory; fall back to unowned alternatives only when nothing owned qualifies.

**Architecture:** New `equivalents-service` composes existing registry/search primitives. A shared `roles` helper defines shade↔contrast equivalence and is used by both the new service and the existing `search-engine.matchesFilters`. Surfaces: new CLI subcommand `warpaint match equivalents`, passive enrichment of `paint show` (CLI + MCP), new MCP tool `paint_equivalents`.

**Tech Stack:** Node.js ESM (`.mjs`), `node --test`, `zod/v4`, `@modelcontextprotocol/sdk`.

**Spec:** [`docs/superpowers/specs/2026-04-17-warpaint-cross-provider-equivalents-design.md`](../specs/2026-04-17-warpaint-cross-provider-equivalents-design.md)

---

## File Map

### New files
- `src/roles.mjs` — pure role normalization helpers (`normalizeRole`, `rolesMatch`)
- `src/equivalents-service.mjs` — `findEquivalents(registry, paintRef, options)` core
- `tests/roles.test.mjs`
- `tests/equivalents-service.test.mjs`

### Modified files
- `src/search-engine.mjs` — export `colorDistance`; use `rolesMatch` in `matchesFilters`
- `src/paint-service.mjs` — add `findPaintEquivalents`; extend `showPaint` with `equivalents`
- `src/commands/match.mjs` — add `equivalents` subcommand branch
- `src/commands/paint.mjs` — enrich `show` handler with equivalents block + field
- `src/mcp-tools.mjs` — add `paint_equivalents` tool; `paint_show` already gains `equivalents` via `showPaint`
- `src/output.mjs` — add `formatEquivalentsText` helper; `renderResult` strips `equivalents_text` from JSON payload
- `tests/search-engine.test.mjs` — retrofit assertion
- `tests/paint-service.test.mjs` — coverage for new/extended functions
- `tests/cli.test.mjs` — coverage for new subcommand + `paint show` enrichment
- `tests/mcp-tools.test.mjs` — coverage for new tool + extended `paint_show`
- `README.md` — document the new command and tool

---

## Task 1: Role normalization helpers

**Files:**
- Create: `src/roles.mjs`
- Create: `tests/roles.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/roles.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeRole, rolesMatch } from '../src/roles.mjs';

test('normalizeRole maps shade and contrast to wash', () => {
  assert.equal(normalizeRole('shade'), 'wash');
  assert.equal(normalizeRole('contrast'), 'wash');
});

test('normalizeRole passes through other roles', () => {
  assert.equal(normalizeRole('base'), 'base');
  assert.equal(normalizeRole('layer'), 'layer');
  assert.equal(normalizeRole('metallic'), 'metallic');
});

test('normalizeRole handles unknown or empty input', () => {
  assert.equal(normalizeRole(''), '');
  assert.equal(normalizeRole('unknown'), 'unknown');
});

test('rolesMatch treats shade and contrast as equivalent', () => {
  assert.equal(rolesMatch('shade', 'contrast'), true);
  assert.equal(rolesMatch('contrast', 'shade'), true);
  assert.equal(rolesMatch('shade', 'shade'), true);
});

test('rolesMatch rejects differing role families', () => {
  assert.equal(rolesMatch('base', 'shade'), false);
  assert.equal(rolesMatch('layer', 'metallic'), false);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/roles.test.mjs`
Expected: fail with a module-not-found error for `../src/roles.mjs`.

- [ ] **Step 3: Implement the helper**

Create `src/roles.mjs`:

```js
const WASH_ROLES = new Set(['shade', 'contrast']);

export function normalizeRole(role) {
  if (typeof role !== 'string') {
    return role;
  }

  if (WASH_ROLES.has(role)) {
    return 'wash';
  }

  return role;
}

export function rolesMatch(a, b) {
  return normalizeRole(a) === normalizeRole(b);
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test tests/roles.test.mjs`
Expected: all five tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/roles.mjs tests/roles.test.mjs
git commit -m "feat: add role normalization helper with shade/contrast equivalence"
```

---

## Task 2: Retrofit search-engine role filter and export colorDistance

**Files:**
- Modify: `src/search-engine.mjs` (lines 44–62 `matchesFilters`, line 158 `colorDistance`)
- Modify: `tests/search-engine.test.mjs`

- [ ] **Step 1: Add the failing retrofit assertion**

Append to `tests/search-engine.test.mjs`:

```js
import { colorDistance } from '../src/search-engine.mjs';

test('searchPaints usageRole filter treats shade and contrast as equivalent', () => {
  const registry = {
    version: 1,
    catalog: {
      providers: [{ id: 'citadel', name: 'Citadel' }],
      paints: [
        {
          id: 'citadel/agrax',
          provider: 'citadel',
          name: 'Agrax Earthshade',
          normalized_name: 'agrax earthshade',
          aliases: [],
          usage_roles: ['shade'],
          color_families: ['brown'],
          rgb: { r: 93, g: 68, b: 49 },
          owned: false,
        },
        {
          id: 'citadel/skeleton-horde',
          provider: 'citadel',
          name: 'Skeleton Horde',
          normalized_name: 'skeleton horde',
          aliases: [],
          usage_roles: ['contrast'],
          color_families: ['bone'],
          rgb: { r: 170, g: 135, b: 88 },
          owned: false,
        },
      ],
    },
  };

  const filteredByShade = searchPaints(registry, '', { usageRole: 'shade' });
  const filteredByContrast = searchPaints(registry, '', { usageRole: 'contrast' });

  assert.deepEqual(
    filteredByShade.map((result) => result.paint.id).sort(),
    ['citadel/agrax', 'citadel/skeleton-horde'],
  );
  assert.deepEqual(
    filteredByContrast.map((result) => result.paint.id).sort(),
    ['citadel/agrax', 'citadel/skeleton-horde'],
  );
});

test('colorDistance is exported and computes Euclidean RGB distance', () => {
  const d = colorDistance({ r: 0, g: 0, b: 0 }, { r: 3, g: 4, b: 0 });
  assert.equal(d, 5);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/search-engine.test.mjs`
Expected: first test fails (only one paint returned per filter — `usageRole: 'shade'` matches only `agrax`), second fails with `colorDistance is not exported`.

- [ ] **Step 3: Modify `src/search-engine.mjs`**

At the top, add the roles import:

```js
import { rolesMatch } from './roles.mjs';
```

Replace the body of `matchesFilters` (currently lines 44–62). The old role check was:

```js
if (options.usageRole && !paint.usage_roles.includes(options.usageRole)) {
  return false;
}
```

Replace with:

```js
if (options.usageRole
  && !paint.usage_roles.some((role) => rolesMatch(role, options.usageRole))) {
  return false;
}
```

Change the `colorDistance` declaration from `function colorDistance` to an exported function. The existing line is:

```js
function colorDistance(left, right) {
```

Change to:

```js
export function colorDistance(left, right) {
```

Leave `matchByColor` calling it unchanged (local call still works).

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test tests/search-engine.test.mjs`
Expected: all prior tests still pass, plus two new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/search-engine.mjs tests/search-engine.test.mjs
git commit -m "refactor: use rolesMatch in search filters and export colorDistance"
```

---

## Task 3: Equivalents service

**Files:**
- Create: `src/equivalents-service.mjs`
- Create: `tests/equivalents-service.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/equivalents-service.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { findEquivalents } from '../src/equivalents-service.mjs';

function makeRegistry(overrides = []) {
  const basePaints = [
    {
      id: 'citadel/mephiston-red',
      provider: 'citadel',
      name: 'Mephiston Red',
      normalized_name: 'mephiston red',
      aliases: [],
      usage_roles: ['base'],
      color_families: ['red'],
      rgb: { r: 146, g: 27, b: 41 },
      owned: false,
    },
    {
      id: 'army_painter/dragon-red',
      provider: 'army_painter',
      name: 'Dragon Red',
      normalized_name: 'dragon red',
      aliases: [],
      usage_roles: ['base'],
      color_families: ['red'],
      rgb: { r: 170, g: 33, b: 31 },
      owned: false,
    },
    {
      id: 'citadel/agrax-earthshade',
      provider: 'citadel',
      name: 'Agrax Earthshade',
      normalized_name: 'agrax earthshade',
      aliases: [],
      usage_roles: ['shade'],
      color_families: ['brown'],
      rgb: { r: 93, g: 68, b: 49 },
      owned: false,
    },
    {
      id: 'army_painter/skeleton-tone',
      provider: 'army_painter',
      name: 'Skeleton Tone',
      normalized_name: 'skeleton tone',
      aliases: [],
      usage_roles: ['contrast'],
      color_families: ['brown'],
      rgb: { r: 100, g: 72, b: 52 },
      owned: false,
    },
  ];

  const paints = basePaints.map((paint) => {
    const patch = overrides.find((entry) => entry.id === paint.id) || {};
    return { ...paint, ...patch };
  });

  return {
    version: 1,
    catalog: {
      providers: [
        { id: 'citadel', name: 'Citadel' },
        { id: 'army_painter', name: 'Army Painter' },
      ],
      paints,
    },
  };
}

test('findEquivalents returns owned cross-provider match when available', () => {
  const registry = makeRegistry([
    { id: 'army_painter/dragon-red', owned: true },
  ]);

  const result = findEquivalents(registry, 'Mephiston Red');

  assert.equal(result.source.id, 'citadel/mephiston-red');
  assert.deepEqual(result.owned.map((entry) => entry.paint.id), ['army_painter/dragon-red']);
  assert.deepEqual(result.alternatives, []);
  assert.ok(result.owned[0].distance > 0 && result.owned[0].distance < 60);
});

test('findEquivalents falls back to unowned alternatives when nothing owned qualifies', () => {
  const registry = makeRegistry();

  const result = findEquivalents(registry, 'Mephiston Red');

  assert.deepEqual(result.owned, []);
  assert.deepEqual(result.alternatives.map((entry) => entry.paint.id), ['army_painter/dragon-red']);
});

test('findEquivalents treats shade and contrast as the same role', () => {
  const registry = makeRegistry([
    { id: 'army_painter/skeleton-tone', owned: true },
  ]);

  const result = findEquivalents(registry, 'Agrax Earthshade');

  assert.deepEqual(result.owned.map((entry) => entry.paint.id), ['army_painter/skeleton-tone']);
});

test('findEquivalents excludes the source paint itself', () => {
  const registry = makeRegistry([
    { id: 'citadel/mephiston-red', owned: true },
  ]);

  const result = findEquivalents(registry, 'Mephiston Red', {
    includeSameProvider: true,
  });

  const ids = [
    ...result.owned.map((entry) => entry.paint.id),
    ...result.alternatives.map((entry) => entry.paint.id),
  ];
  assert.ok(!ids.includes('citadel/mephiston-red'));
});

test('findEquivalents excludes same provider by default and includes it when opted in', () => {
  const registry = makeRegistry([
    { id: 'citadel/agrax-earthshade', owned: true, rgb: { r: 140, g: 30, b: 40 }, usage_roles: ['base'] },
  ]);

  const defaultResult = findEquivalents(registry, 'Mephiston Red');
  const opened = findEquivalents(registry, 'Mephiston Red', { includeSameProvider: true });

  assert.ok(!defaultResult.owned.some((entry) => entry.paint.provider === 'citadel'));
  assert.ok(opened.owned.some((entry) => entry.paint.id === 'citadel/agrax-earthshade'));
});

test('findEquivalents respects maxDistance and limit', () => {
  const registry = makeRegistry([
    { id: 'army_painter/dragon-red', owned: true },
    { id: 'army_painter/skeleton-tone', owned: true, rgb: { r: 148, g: 29, b: 44 }, usage_roles: ['base'] },
  ]);

  const tight = findEquivalents(registry, 'Mephiston Red', { maxDistance: 5 });
  const capped = findEquivalents(registry, 'Mephiston Red', { limit: 1 });

  assert.deepEqual(tight.owned.map((entry) => entry.paint.id), ['army_painter/skeleton-tone']);
  assert.equal(capped.owned.length, 1);
  assert.equal(capped.owned[0].paint.id, 'army_painter/skeleton-tone');
});

test('findEquivalents sorts by distance then name for ties', () => {
  const registry = makeRegistry([
    { id: 'army_painter/dragon-red', owned: true, rgb: { r: 146, g: 27, b: 41 } },
    { id: 'army_painter/skeleton-tone', owned: true, rgb: { r: 146, g: 27, b: 41 }, usage_roles: ['base'] },
  ]);

  const result = findEquivalents(registry, 'Mephiston Red');

  assert.deepEqual(
    result.owned.map((entry) => entry.paint.id),
    ['army_painter/dragon-red', 'army_painter/skeleton-tone'],
  );
});

test('findEquivalents propagates not_found and ambiguous resolutions', () => {
  const ambiguousRegistry = makeRegistry([
    { id: 'citadel/mephiston-red', aliases: ['red'] },
    { id: 'army_painter/dragon-red', aliases: ['red'] },
  ]);

  const notFound = findEquivalents(ambiguousRegistry, 'Nonexistent Paint');
  assert.equal(notFound.status, 'not_found');
  assert.ok(Array.isArray(notFound.matches));

  const ambiguous = findEquivalents(ambiguousRegistry, 'red');
  assert.equal(ambiguous.status, 'ambiguous');
  assert.ok(ambiguous.matches.length >= 2);
});

test('findEquivalents returns reason when source paint lacks rgb', () => {
  const registry = makeRegistry();
  const noRgb = { ...registry.catalog.paints[0], rgb: null };

  const result = findEquivalents(registry, noRgb);

  assert.deepEqual(result.owned, []);
  assert.deepEqual(result.alternatives, []);
  assert.equal(result.reason, 'source_missing_rgb');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/equivalents-service.test.mjs`
Expected: fails with module-not-found for `../src/equivalents-service.mjs`.

- [ ] **Step 3: Implement the service**

Create `src/equivalents-service.mjs`:

```js
import { colorDistance, resolvePaint } from './search-engine.mjs';
import { rolesMatch } from './roles.mjs';

const DEFAULT_MAX_DISTANCE = 60;
const DEFAULT_LIMIT = 3;

function resolveSource(registry, paintRef) {
  if (paintRef && typeof paintRef === 'object') {
    return { status: 'resolved', paint: paintRef };
  }

  return resolvePaint(registry, paintRef);
}

function rolesOverlap(source, candidate) {
  return source.usage_roles.some((sourceRole) => candidate.usage_roles.some(
    (candidateRole) => rolesMatch(sourceRole, candidateRole),
  ));
}

function rankCandidates(candidates, maxDistance, limit) {
  return candidates
    .filter((entry) => entry.distance <= maxDistance)
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      return left.paint.name.localeCompare(right.paint.name);
    })
    .slice(0, limit);
}

export function findEquivalents(registry, paintRef, options = {}) {
  const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const includeSameProvider = options.includeSameProvider === true;

  const resolution = resolveSource(registry, paintRef);

  if (resolution.status !== 'resolved') {
    return resolution;
  }

  const source = resolution.paint;
  const thresholds = { maxDistance, limit, includeSameProvider };

  if (!source.rgb) {
    return {
      source,
      owned: [],
      alternatives: [],
      thresholds,
      reason: 'source_missing_rgb',
    };
  }

  const scored = registry.catalog.paints
    .filter((paint) => paint.id !== source.id)
    .filter((paint) => includeSameProvider || paint.provider !== source.provider)
    .filter((paint) => rolesOverlap(source, paint))
    .map((paint) => ({ paint, distance: colorDistance(source.rgb, paint.rgb) }));

  const owned = rankCandidates(scored.filter((entry) => entry.paint.owned), maxDistance, limit);
  const alternatives = owned.length > 0
    ? []
    : rankCandidates(scored.filter((entry) => !entry.paint.owned), maxDistance, limit);

  return { source, owned, alternatives, thresholds };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test tests/equivalents-service.test.mjs`
Expected: all nine tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/equivalents-service.mjs tests/equivalents-service.test.mjs
git commit -m "feat: add equivalents service for owned-first cross-provider matching"
```

---

## Task 4: Output helper for equivalents text

**Files:**
- Modify: `src/output.mjs`

- [ ] **Step 1: Add the helper directly (no dedicated test file; verified via CLI tests in later tasks)**

Open `src/output.mjs`. Replace the entire contents with:

```js
function jsonReplacer(_key, value) {
  if (value === undefined) {
    return null;
  }

  return value;
}

function isRenderablePaint(item) {
  return item && typeof item.name === 'string' && typeof item.id === 'string';
}

function toHex(rgb) {
  if (!rgb) {
    return '';
  }

  const hex = (value) => value.toString(16).padStart(2, '0');
  return `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}`;
}

function formatEquivalentEntry(entry) {
  const { paint, distance } = entry;
  const role = paint.usage_roles?.[0] ?? '';
  const distanceLabel = `≈ ${Math.round(distance)}`;
  return `  - ${paint.name} (${paint.provider})  role: ${role}  ${distanceLabel}  ${toHex(paint.rgb)}`;
}

export function formatEquivalentsText(equivalents, options = {}) {
  if (!equivalents) {
    return '';
  }

  const includeAlternatives = options.includeAlternatives === true;

  if (equivalents.reason === 'source_missing_rgb') {
    return includeAlternatives ? 'No equivalents available (source paint has no rgb).' : '';
  }

  if (equivalents.owned?.length) {
    const lines = ['Equivalents you own:', ...equivalents.owned.map(formatEquivalentEntry)];
    return lines.join('\n');
  }

  if (!includeAlternatives) {
    return '';
  }

  const threshold = equivalents.thresholds?.maxDistance ?? '';
  const header = `Nothing owned qualifies within distance ${threshold}.`;

  if (!equivalents.alternatives?.length) {
    return `${header}\n\nNo close alternatives found either.`;
  }

  const lines = [
    header,
    '',
    'Alternatives:',
    ...equivalents.alternatives.map(formatEquivalentEntry),
  ];
  return lines.join('\n');
}

export function renderResult(result, options = {}) {
  if (options.json) {
    const { equivalents_text: _unused, ...jsonResult } = result;
    return `${JSON.stringify(jsonResult, jsonReplacer, 2)}\n`;
  }

  const lines = [];

  if (result.message) {
    lines.push(result.message);
  }

  if (isRenderablePaint(result.item)) {
    lines.push(`${result.item.name} [${result.item.id}]${result.item.owned ? ' owned' : ''}`);
  }

  if (result.items) {
    lines.push(...result.items
      .filter(isRenderablePaint)
      .map((item) => `${item.name} [${item.id}]${item.owned ? ' owned' : ''}`));
  }

  if (result.equivalents_text) {
    lines.push('', result.equivalents_text);
  }

  return `${lines.join('\n')}\n`;
}
```

- [ ] **Step 2: Run the full suite to verify no regressions**

Run: `node --test`
Expected: all existing tests still pass. No new behavior asserted yet (commands don't set `equivalents_text` yet).

- [ ] **Step 3: Commit**

```bash
git add src/output.mjs
git commit -m "feat: add formatEquivalentsText helper and strip text field from json output"
```

---

## Task 5: CLI `warpaint match equivalents` subcommand

**Files:**
- Modify: `src/commands/match.mjs`
- Modify: `tests/cli.test.mjs`

- [ ] **Step 1: Write the failing CLI tests**

Append to `tests/cli.test.mjs`:

```js
test('match equivalents returns owned cross-provider match with json output', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });
  await runCli(['inventory', 'own', 'Matt Black'], { cwd });

  const result = await runCli(['match', 'equivalents', 'Abaddon Black', '--json'], { cwd });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(payload.equivalents.source.id, 'citadel/abaddon-black');
  assert.deepEqual(
    payload.equivalents.owned.map((entry) => entry.paint.id),
    ['army_painter/matt-black'],
  );
  assert.deepEqual(payload.equivalents.alternatives, []);
});

test('match equivalents human output shows owned block when owned qualifies', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });
  await runCli(['inventory', 'own', 'Matt Black'], { cwd });

  const result = await runCli(['match', 'equivalents', 'Abaddon Black'], { cwd });

  assert.match(result.stdout, /Equivalents for:\s+Abaddon Black/);
  assert.match(result.stdout, /Equivalents you own:/);
  assert.match(result.stdout, /Matt Black \(army_painter\)/);
});

test('match equivalents falls back to alternatives when nothing owned', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });

  const result = await runCli(['match', 'equivalents', 'Abaddon Black'], { cwd });

  assert.match(result.stdout, /Nothing owned qualifies/);
  assert.match(result.stdout, /Alternatives:/);
  assert.match(result.stdout, /Matt Black \(army_painter\)/);
});

test('match equivalents reports not_found for unknown paint', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });

  const result = await runCli(['match', 'equivalents', 'Nonexistent Pigment', '--json'], { cwd });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(payload.status, 'not_found');
});

test('match equivalents include-same-provider flag widens the candidate pool', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });
  await runCli(['inventory', 'own', 'Corax White'], { cwd });

  const result = await runCli(
    ['match', 'equivalents', 'Abaddon Black', '--include-same-provider', '--max-distance', '500', '--json'],
    { cwd },
  );
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.equivalents.thresholds.includeSameProvider, true);
  assert.ok(
    payload.equivalents.owned.some((entry) => entry.paint.id === 'citadel/corax-white'),
  );
});
```

- [ ] **Step 2: Run the CLI test file and verify new tests fail**

Run: `node --test tests/cli.test.mjs`
Expected: new five tests fail (unknown subcommand / no equivalents key), existing tests still pass.

- [ ] **Step 3: Implement the subcommand**

Replace `src/commands/match.mjs` with:

```js
import { loadRegistry } from '../registry-store.mjs';
import { matchByColor, searchPaints } from '../search-engine.mjs';
import { findEquivalents } from '../equivalents-service.mjs';
import { formatEquivalentsText } from '../output.mjs';

function stripMatch(result) {
  return {
    id: result.paint.id,
    provider: result.paint.provider,
    name: result.paint.name,
    owned: result.paint.owned,
    usage_roles: result.paint.usage_roles,
    color_families: result.paint.color_families,
    rgb: result.paint.rgb,
    distance: result.distance ?? null,
    score: result.score ?? null,
  };
}

function stripPaint(paint) {
  return {
    id: paint.id,
    provider: paint.provider,
    name: paint.name,
    owned: paint.owned,
    aliases: paint.aliases,
    usage_roles: paint.usage_roles,
    color_families: paint.color_families,
    rgb: paint.rgb,
  };
}

function stripEntry(entry) {
  return { paint: stripPaint(entry.paint), distance: entry.distance };
}

function stripEquivalents(equivalents) {
  return {
    source: stripPaint(equivalents.source),
    owned: equivalents.owned.map(stripEntry),
    alternatives: equivalents.alternatives.map(stripEntry),
    thresholds: equivalents.thresholds,
    ...(equivalents.reason ? { reason: equivalents.reason } : {}),
  };
}

function parseHexColor(value) {
  const normalized = value.replace('#', '');

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error('Color must be a 6-digit hex value');
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function parseEquivalentsFlags(args) {
  const positional = [];
  const options = {};
  let index = 0;

  while (index < args.length) {
    const arg = args[index];
    if (arg === '--include-same-provider') {
      options.includeSameProvider = true;
      index += 1;
    } else if (arg === '--max-distance') {
      options.maxDistance = Number.parseFloat(args[index + 1]);
      index += 2;
    } else if (arg === '--limit') {
      options.limit = Number.parseInt(args[index + 1], 10);
      index += 2;
    } else {
      positional.push(arg);
      index += 1;
    }
  }

  return { positional, options };
}

function formatHeader(source) {
  const role = source.usage_roles?.[0] ?? '';
  const rgb = source.rgb ? `${source.rgb.r},${source.rgb.g},${source.rgb.b}` : 'n/a';
  return `Equivalents for: ${source.name} (${source.provider}) • role: ${role} • rgb: ${rgb}`;
}

export async function runMatchCommand(args, context) {
  const registry = await loadRegistry(context.registryPath);
  const [subcommand, ...rest] = args;

  if (subcommand === 'color') {
    const rgb = parseHexColor(rest[0]);
    return {
      message: 'Color matches',
      items: matchByColor(registry, rgb).map(stripMatch),
    };
  }

  if (subcommand === 'describe') {
    return {
      message: 'Described paint matches',
      items: searchPaints(registry, rest[0] || '').map(stripMatch),
    };
  }

  if (subcommand === 'equivalents') {
    const { positional, options } = parseEquivalentsFlags(rest);
    const target = positional[0];

    if (!target) {
      throw new Error('match equivalents requires a paint name');
    }

    const result = findEquivalents(registry, target, options);

    if (result.status === 'not_found' || result.status === 'ambiguous') {
      return {
        status: result.status,
        message: result.status === 'not_found' ? 'Paint not found' : 'Paint is ambiguous',
        items: (result.matches || []).map(stripPaint),
      };
    }

    const equivalents = stripEquivalents(result);
    const header = formatHeader(equivalents.source);
    const body = formatEquivalentsText(equivalents, { includeAlternatives: true });
    const message = body ? `${header}\n\n${body}` : header;

    return {
      message,
      equivalents,
      equivalents_text: '',
    };
  }

  throw new Error('Unknown match command');
}
```

Note: the `message` field already contains the full pre-formatted block (header + body). `equivalents_text` is intentionally set to an empty string so `renderResult` does not double-render it in text mode, and the field is stripped from JSON output by the renderer's destructuring.

- [ ] **Step 4: Run the CLI test file and verify it passes**

Run: `node --test tests/cli.test.mjs`
Expected: all tests pass, including the five new ones.

- [ ] **Step 5: Commit**

```bash
git add src/commands/match.mjs tests/cli.test.mjs
git commit -m "feat: add warpaint match equivalents subcommand"
```

---

## Task 6: `paint show` CLI enrichment

**Files:**
- Modify: `src/commands/paint.mjs`
- Modify: `tests/cli.test.mjs`

- [ ] **Step 1: Write the failing CLI tests**

Append to `tests/cli.test.mjs`:

```js
test('paint show includes equivalents you own block when owned qualifies', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });
  await runCli(['inventory', 'own', 'Matt Black'], { cwd });

  const result = await runCli(['paint', 'show', 'Abaddon Black'], { cwd });

  assert.match(result.stdout, /Abaddon Black \[citadel\/abaddon-black\]/);
  assert.match(result.stdout, /Equivalents you own:/);
  assert.match(result.stdout, /Matt Black \(army_painter\)/);
});

test('paint show omits equivalents block when nothing owned qualifies', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });

  const result = await runCli(['paint', 'show', 'Abaddon Black'], { cwd });

  assert.doesNotMatch(result.stdout, /Equivalents you own:/);
  assert.doesNotMatch(result.stdout, /Alternatives:/);
});

test('paint show --json includes full equivalents shape regardless of owned state', async () => {
  const cwd = await makeWorkspace();
  await runCli(['catalog', 'sync'], { cwd });

  const result = await runCli(['paint', 'show', 'Abaddon Black', '--json'], { cwd });
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.item.id, 'citadel/abaddon-black');
  assert.ok(payload.equivalents);
  assert.equal(payload.equivalents.source.id, 'citadel/abaddon-black');
  assert.ok(Array.isArray(payload.equivalents.owned));
  assert.ok(Array.isArray(payload.equivalents.alternatives));
  assert.ok(payload.equivalents.thresholds);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test tests/cli.test.mjs`
Expected: three new tests fail (no equivalents block in human output, no equivalents key in JSON).

- [ ] **Step 3: Implement the enrichment**

Replace `src/commands/paint.mjs` with:

```js
import { loadRegistry } from '../registry-store.mjs';
import { resolvePaint, searchPaints } from '../search-engine.mjs';
import { findEquivalents } from '../equivalents-service.mjs';
import { formatEquivalentsText } from '../output.mjs';

function stripResult(result) {
  return {
    id: result.paint.id,
    provider: result.paint.provider,
    name: result.paint.name,
    owned: result.paint.owned,
    usage_roles: result.paint.usage_roles,
    color_families: result.paint.color_families,
    rgb: result.paint.rgb,
    score: result.score,
  };
}

function stripPaint(paint) {
  return {
    id: paint.id,
    provider: paint.provider,
    name: paint.name,
    owned: paint.owned,
    aliases: paint.aliases,
    usage_roles: paint.usage_roles,
    color_families: paint.color_families,
    rgb: paint.rgb,
  };
}

function stripEntry(entry) {
  return { paint: stripPaint(entry.paint), distance: entry.distance };
}

function stripEquivalents(equivalents) {
  return {
    source: stripPaint(equivalents.source),
    owned: equivalents.owned.map(stripEntry),
    alternatives: equivalents.alternatives.map(stripEntry),
    thresholds: equivalents.thresholds,
    ...(equivalents.reason ? { reason: equivalents.reason } : {}),
  };
}

export async function runPaintCommand(args, context) {
  const registry = await loadRegistry(context.registryPath);
  const [subcommand, ...rest] = args;

  if (subcommand === 'search') {
    const query = rest[0] || '';
    const items = searchPaints(registry, query).map(stripResult);
    return {
      message: `Found ${items.length} paint matches`,
      items,
    };
  }

  if (subcommand === 'show') {
    const query = rest[0];
    const result = resolvePaint(registry, query);

    if (result.status !== 'resolved') {
      return {
        message: 'Paint could not be resolved',
        item: null,
        items: result.matches?.map(stripPaint) || [],
      };
    }

    const equivalentsRaw = findEquivalents(registry, result.paint);
    const equivalents = stripEquivalents(equivalentsRaw);
    const equivalentsText = formatEquivalentsText(equivalents, { includeAlternatives: false });

    return {
      message: `Showing ${result.paint.name}`,
      item: stripPaint(result.paint),
      equivalents,
      equivalents_text: equivalentsText || undefined,
    };
  }

  throw new Error('Unknown paint command');
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test tests/cli.test.mjs`
Expected: all tests pass (three new ones and the rest).

- [ ] **Step 5: Verify demo output has not drifted**

Run: `node --test tests/demo-render.test.mjs`
Expected: pass. If it fails because `paint show` output is captured in demo assets, run `npm run generate:demo` and inspect the diff. Only commit asset updates when the change is expected (human-format-only — JSON captures should be unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/commands/paint.mjs tests/cli.test.mjs
git commit -m "feat: enrich paint show with owned equivalents block"
```

If demo assets changed intentionally in Step 5:

```bash
git add docs/assets
git commit -m "chore: regenerate demo output for paint show equivalents"
```

---

## Task 7: `paint-service` facade for equivalents + `showPaint` enrichment

**Files:**
- Modify: `src/paint-service.mjs`
- Modify: `tests/paint-service.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/paint-service.test.mjs`:

```js
import { findPaintEquivalents } from '../src/paint-service.mjs';

test('findPaintEquivalents returns owned entries with paint records and thresholds', async () => {
  const cwd = await makeWorkspace();
  await initPaintRegistry({ cwd });
  await markInventoryOwned({ cwd, paint: 'Matt Black' });

  const result = await findPaintEquivalents({ cwd, paint: 'Abaddon Black' });

  assert.equal(result.status, 'ok');
  assert.equal(result.source.id, 'citadel/abaddon-black');
  assert.deepEqual(
    result.owned.map((entry) => entry.paint.id),
    ['army_painter/matt-black'],
  );
  assert.deepEqual(result.alternatives, []);
  assert.equal(result.thresholds.maxDistance, 60);
  assert.equal(result.thresholds.limit, 3);
  assert.equal(result.thresholds.includeSameProvider, false);
});

test('findPaintEquivalents honors max_distance, limit, include_same_provider options', async () => {
  const cwd = await makeWorkspace();
  await initPaintRegistry({ cwd });
  await markInventoryOwned({ cwd, paint: 'Corax White' });

  const result = await findPaintEquivalents({
    cwd,
    paint: 'Abaddon Black',
    max_distance: 500,
    limit: 1,
    include_same_provider: true,
  });

  assert.equal(result.thresholds.includeSameProvider, true);
  assert.equal(result.thresholds.limit, 1);
  assert.equal(result.thresholds.maxDistance, 500);
  assert.ok(result.owned.some((entry) => entry.paint.id === 'citadel/corax-white'));
});

test('findPaintEquivalents returns not_found for unknown paint', async () => {
  const cwd = await makeWorkspace();
  await initPaintRegistry({ cwd });

  const result = await findPaintEquivalents({ cwd, paint: 'Nonexistent' });

  assert.equal(result.status, 'not_found');
});

test('showPaint attaches equivalents shape for resolved paints', async () => {
  const cwd = await makeWorkspace();
  await initPaintRegistry({ cwd });

  const result = await showPaint({ cwd, paint: 'Abaddon Black' });

  assert.equal(result.status, 'resolved');
  assert.equal(result.item.id, 'citadel/abaddon-black');
  assert.ok(result.equivalents);
  assert.equal(result.equivalents.source.id, 'citadel/abaddon-black');
  assert.ok(Array.isArray(result.equivalents.owned));
  assert.ok(Array.isArray(result.equivalents.alternatives));
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test tests/paint-service.test.mjs`
Expected: four new tests fail (missing export / no equivalents field on showPaint).

- [ ] **Step 3: Modify `src/paint-service.mjs`**

Add imports at the top, after the existing imports:

```js
import { findEquivalents } from './equivalents-service.mjs';
```

Add a helper after `toSearchRecord` (near the top):

```js
function toEquivalentsRecord(equivalents) {
  return {
    source: toPaintRecord(equivalents.source),
    owned: equivalents.owned.map((entry) => ({
      paint: toPaintRecord(entry.paint),
      distance: entry.distance,
    })),
    alternatives: equivalents.alternatives.map((entry) => ({
      paint: toPaintRecord(entry.paint),
      distance: entry.distance,
    })),
    thresholds: equivalents.thresholds,
    ...(equivalents.reason ? { reason: equivalents.reason } : {}),
  };
}
```

Replace `showPaint` with:

```js
export async function showPaint(options = {}) {
  const registry = await loadExistingRegistry(options);
  const result = resolvePaint(registry, options.paint, {
    provider: options.provider,
  });

  if (result.status === 'resolved') {
    const equivalents = findEquivalents(registry, result.paint);
    return {
      status: 'resolved',
      item: toPaintRecord(result.paint),
      equivalents: toEquivalentsRecord(equivalents),
    };
  }

  return {
    status: result.status,
    matches: (result.matches || []).map(toPaintRecord),
  };
}
```

Add the new exported function at the end of the file:

```js
export async function findPaintEquivalents(options = {}) {
  const registry = await loadExistingRegistry(options);
  const result = findEquivalents(registry, options.paint, {
    maxDistance: options.max_distance,
    limit: options.limit,
    includeSameProvider: options.include_same_provider,
  });

  if (result.status === 'not_found' || result.status === 'ambiguous') {
    return {
      status: result.status,
      matches: (result.matches || []).map(toPaintRecord),
    };
  }

  return { status: 'ok', ...toEquivalentsRecord(result) };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test tests/paint-service.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/paint-service.mjs tests/paint-service.test.mjs
git commit -m "feat: expose findPaintEquivalents service and attach equivalents to showPaint"
```

---

## Task 8: MCP tool `paint_equivalents` and `paint_show` enrichment

**Files:**
- Modify: `src/mcp-tools.mjs`
- Modify: `tests/mcp-tools.test.mjs`

- [ ] **Step 1: Write the failing MCP tests**

Modify `tests/mcp-tools.test.mjs`. Replace the existing `getMcpToolDefinitions exposes the expected tool names` test with:

```js
test('getMcpToolDefinitions exposes the expected tool names', () => {
  const definitions = getMcpToolDefinitions();

  assert.deepEqual(
    definitions.map((tool) => tool.name),
    [
      'paint_search',
      'paint_show',
      'inventory_list',
      'inventory_mark_owned',
      'inventory_mark_unowned',
      'match_color',
      'match_describe',
      'paint_equivalents',
    ],
  );
});
```

Append these tests to the end of the file:

```js
test('paint_equivalents tool returns owned-first structured results', async () => {
  const cwd = await makeWorkspace();
  const handlers = createMcpToolHandlers({ cwd });

  await handlers.inventory_mark_owned({ paint: 'Matt Black', initialize_registry: true });
  const result = await handlers.paint_equivalents({ paint: 'Abaddon Black' });

  assert.equal(result.status, 'ok');
  assert.equal(result.source.id, 'citadel/abaddon-black');
  assert.deepEqual(
    result.owned.map((entry) => entry.paint.id),
    ['army_painter/matt-black'],
  );
  assert.deepEqual(result.alternatives, []);
  assert.equal(result.thresholds.includeSameProvider, false);
});

test('paint_equivalents tool reports not_found for unknown paint', async () => {
  const cwd = await makeWorkspace();
  const handlers = createMcpToolHandlers({ cwd });

  const result = await handlers.paint_equivalents({ paint: 'Nonexistent', initialize_registry: true });

  assert.equal(result.status, 'not_found');
});

test('paint_equivalents tool reports ambiguous for alias that resolves to multiple paints', async () => {
  const cwd = await makeWorkspace();
  const handlers = createMcpToolHandlers({ cwd });

  const result = await handlers.paint_equivalents({ paint: 'black', initialize_registry: true });

  assert.equal(result.status, 'ambiguous');
  assert.ok(result.matches.length >= 2);
});

test('paint_show tool response includes equivalents field', async () => {
  const cwd = await makeWorkspace();
  const handlers = createMcpToolHandlers({ cwd });

  const result = await handlers.paint_show({ paint: 'Abaddon Black', initialize_registry: true });

  assert.equal(result.status, 'resolved');
  assert.ok(result.equivalents);
  assert.equal(result.equivalents.source.id, 'citadel/abaddon-black');
  assert.ok(Array.isArray(result.equivalents.owned));
  assert.ok(Array.isArray(result.equivalents.alternatives));
});
```

Update the README assertion test at the bottom of the file. Replace the existing README test with:

```js
test('README documents local Claude Desktop MCP setup and new tools', async () => {
  const readme = await fs.readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /## Claude Desktop MCP Setup/);
  assert.match(readme, /node src\/mcp-server\.mjs/);
  assert.match(readme, /paint_search/);
  assert.match(readme, /paint_equivalents/);
});
```

- [ ] **Step 2: Run the MCP tests and verify they fail**

Run: `node --test tests/mcp-tools.test.mjs`
Expected: fails (missing `paint_equivalents` tool, missing README entry, missing `equivalents` field on `paint_show`).

- [ ] **Step 3: Modify `src/mcp-tools.mjs`**

Update the import list to include `findPaintEquivalents`:

```js
import {
  findPaintEquivalents,
  initPaintRegistry,
  listInventory,
  markInventoryOwned,
  markInventoryUnowned,
  matchPaintByColor,
  matchPaintByDescription,
  searchPaintCatalog,
  showPaint,
} from './paint-service.mjs';
```

Add a new handler to `createMcpToolHandlers`, inserted after `match_describe`:

```js
    paint_equivalents: async (args = {}) => withRegistryInit(
      { ...baseOptions, ...args },
      (options) => findPaintEquivalents(options),
    ),
```

Add a new tool definition at the end of the `getMcpToolDefinitions` return array:

```js
    {
      name: 'paint_equivalents',
      description: 'Find cross-provider equivalents for a paint. Returns owned substitutes first; falls back to unowned alternatives only when nothing owned qualifies. Shade and contrast roles are treated as equivalent. Same provider is excluded by default.',
      inputSchema: {
        paint: z.string().describe('Paint name, alias, or id'),
        max_distance: z.number().optional().describe('Maximum RGB Euclidean distance (default 60)'),
        limit: z.number().optional().describe('Maximum results per section (default 3)'),
        include_same_provider: z.boolean().optional().describe('Include paints from the same provider as the source'),
        initialize_registry: z.boolean().optional().describe('Initialize the registry if it does not exist'),
      },
    },
```

- [ ] **Step 4: Update the README**

Open `README.md`. Find the list of MCP tools under "After adding the server, Claude Desktop can call tools such as:" and append a new bullet:

```markdown
- `paint_equivalents`
```

Find the list of CLI commands in the Quickstart or TUI section; add a short new section after the `match describe` / `match color` examples:

```markdown
Find owned equivalents from another brand:

\`\`\`bash
node src/cli.mjs match equivalents "Mephiston Red"
\`\`\`
```

(Replace `\`\`\`` with actual triple backticks when editing; they're escaped here only for the plan markdown.)

- [ ] **Step 5: Run the full suite and verify it passes**

Run: `node --test`
Expected: all tests pass across all files.

- [ ] **Step 6: Commit**

```bash
git add src/mcp-tools.mjs tests/mcp-tools.test.mjs README.md
git commit -m "feat: add paint_equivalents mcp tool and enrich paint_show response"
```

---

## Task 9: Final sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite from scratch**

Run: `node --test`
Expected: all tests pass. If any fail, triage inside this task rather than declaring complete.

- [ ] **Step 2: Smoke-test the CLI end-to-end in a temp workspace**

```bash
TMPDIR=$(mktemp -d) && \
  (cd "$TMPDIR" && node "$OLDPWD/src/cli.mjs" catalog sync) && \
  (cd "$TMPDIR" && node "$OLDPWD/src/cli.mjs" inventory own "Matt Black") && \
  (cd "$TMPDIR" && node "$OLDPWD/src/cli.mjs" match equivalents "Abaddon Black") && \
  (cd "$TMPDIR" && node "$OLDPWD/src/cli.mjs" paint show "Abaddon Black")
```

Expected: the `match equivalents` command prints the header and an "Equivalents you own" block containing `Matt Black (army_painter)`. The `paint show` command prints the standard paint line plus the same "Equivalents you own" block.

- [ ] **Step 3: Smoke-test the MCP server spins up**

```bash
timeout 2 node src/mcp-server.mjs </dev/null ; true
```

Expected: no crash on startup. (The server listens on stdio and idles without input; timing out is fine.)

- [ ] **Step 4: No new commit unless a regression was fixed here**

If Step 1–3 all pass, this task is done without additional commits.

---

## Self-review notes (for plan author)

- Spec coverage:
  - Matching definition (role merge, threshold, provider exclusion, source exclusion) — Task 3.
  - Ranking and output semantics (owned-first, fallback, partition, sort, truncate) — Task 3.
  - `src/roles.mjs` + retrofit in search-engine — Tasks 1, 2.
  - `src/equivalents-service.mjs` — Task 3.
  - CLI `match equivalents` with `--json`, `--max-distance`, `--limit`, `--include-same-provider` — Task 5.
  - CLI `paint show` enrichment — Task 6.
  - `src/paint-service.mjs` `findPaintEquivalents` — Task 7.
  - MCP `paint_equivalents` tool + `paint_show` `equivalents` field — Task 8.
  - Testing matrix — covered per task (roles, equivalents-service, search-engine retrofit, paint-service, CLI, MCP).
  - README update — Task 8.
  - Demo regeneration check — Task 6 Step 5.

- Type/name consistency:
  - `normalizeRole`, `rolesMatch` — consistent across tasks.
  - `findEquivalents` (service) vs `findPaintEquivalents` (service facade) — distinct names, each introduced in one task.
  - `formatEquivalentsText(equivalents, { includeAlternatives })` — same signature everywhere.
  - Entry shape `{ paint, distance }` — same in service, paint-service, CLI, MCP.
  - Field names: `max_distance`, `limit`, `include_same_provider` (snake_case at MCP/options boundary); `maxDistance`, `limit`, `includeSameProvider` (camelCase in `findEquivalents` options) — matches the project's existing boundary convention (snake_case MCP input, camelCase internal).
