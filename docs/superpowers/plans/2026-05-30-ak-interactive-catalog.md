# AK Interactive Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible AK Interactive paint catalog (`data/catalog/ak_interactive.json`, 613 hobby paints) sourced from `alexparlett/hobby-desk-data`, with overlay rules giving every AK paint a `product_format`.

**Architecture:** A pure, fully-tested transform module (`scripts/ak-transform.mjs`) converts hobby-desk-data records to our paint schema; a thin I/O wrapper (`scripts/import-ak.mjs`) reads the 5 AK source files from a local directory and writes the catalog JSON. The committed JSON is the script's output; corrections go to `data/overrides/`, never to the generated file.

**Tech Stack:** Node.js ESM, `node --test`, `node:assert/strict`. No runtime/test network access.

**Spec:** `docs/superpowers/specs/2026-05-30-ak-interactive-catalog-design.md`. Pinned source commit: `1bc4e0901442a9147d8a79547236a7e4170e4483`.

---

## File Structure

- `scripts/ak-transform.mjs` (create) — pure functions: `slugify`, `hexToRgb`, `classifyColorFamily`, `TYPE_TO_ROLE`, `buildPaint`, `transformCatalog`. No I/O. The single source of truth for the transform.
- `scripts/import-ak.mjs` (create) — CLI wrapper: read 5 JSON files from a source dir, call `transformCatalog`, write sorted catalog JSON.
- `tests/ak-transform.test.mjs` (create) — unit tests for the transform.
- `tests/ak-catalog.test.mjs` (create) — integration test against the generated catalog via the built-in catalog loader.
- `data/overrides/product_formats.json` (modify) — add `ak_interactive` rules.
- `data/catalog/ak_interactive.json` (create) — generated output, committed.

---

### Task 1: Pure transform helpers — slug, hex, color family

**Files:**
- Create: `scripts/ak-transform.mjs`
- Test: `tests/ak-transform.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/ak-transform.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  slugify,
  hexToRgb,
  classifyColorFamily,
} from '../scripts/ak-transform.mjs';

test('slugify lowercases and dashes non-alphanumerics', () => {
  assert.equal(slugify('Dark Grey-Blue'), 'dark-grey-blue');
  assert.equal(slugify('  A-18f  Light/Grey '), 'a-18f-light-grey');
});

test('hexToRgb parses #RRGGBB with or without hash', () => {
  assert.deepEqual(hexToRgb('#1A6AB8'), { r: 26, g: 106, b: 184 });
  assert.deepEqual(hexToRgb('FFFFFF'), { r: 255, g: 255, b: 255 });
});

test('hexToRgb throws on invalid input', () => {
  assert.throws(() => hexToRgb('#12'), /invalid hex/i);
  assert.throws(() => hexToRgb(''), /invalid hex/i);
});

test('classifyColorFamily maps achromatic and hue regions', () => {
  assert.equal(classifyColorFamily({ r: 0, g: 0, b: 0 }), 'black');
  assert.equal(classifyColorFamily({ r: 255, g: 255, b: 255 }), 'white');
  assert.equal(classifyColorFamily({ r: 128, g: 128, b: 128 }), 'grey');
  assert.equal(classifyColorFamily({ r: 220, g: 20, b: 20 }), 'red');
  assert.equal(classifyColorFamily({ r: 30, g: 120, b: 220 }), 'blue');
  assert.equal(classifyColorFamily({ r: 230, g: 200, b: 40 }), 'yellow');
  assert.equal(classifyColorFamily({ r: 40, g: 160, b: 60 }), 'green');
  // dark orange region reads as brown
  assert.equal(classifyColorFamily({ r: 90, g: 55, b: 25 }), 'brown');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ak-transform.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/ak-transform.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/ak-transform.mjs

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function hexToRgb(hex) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  if (!match) throw new Error(`invalid hex: ${JSON.stringify(hex)}`);
  const int = parseInt(match[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  let s = 0;
  let h = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

export function classifyColorFamily(rgb) {
  const { h, s, l } = rgbToHsl(rgb);
  if (l < 0.12) return 'black';
  if (l > 0.88 && s < 0.15) return 'white';
  if (s < 0.12) return 'grey';
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return l < 0.4 ? 'brown' : 'orange';
  if (h < 70) return l < 0.35 ? 'brown' : 'yellow';
  if (h < 170) return 'green';
  if (h < 260) return 'blue';
  if (h < 320) return 'purple';
  return 'pink';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ak-transform.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/ak-transform.mjs tests/ak-transform.test.mjs
git commit -m "feat(ak): slug/hex/color-family transform helpers"
```

---

### Task 2: Record transform — `buildPaint` and `TYPE_TO_ROLE`

**Files:**
- Modify: `scripts/ak-transform.mjs`
- Test: `tests/ak-transform.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/ak-transform.test.mjs`:

```javascript
import { buildPaint, TYPE_TO_ROLE } from '../scripts/ak-transform.mjs';

const SRC = {
  brand: 'AK Interactive',
  name: 'Dark Grey-Blue',
  sku: 'AK11201',
  type: 'opaque',
  hex: '#3B4A5A',
  range: '3rd Generation',
};

test('TYPE_TO_ROLE covers every in-scope AK type', () => {
  assert.deepEqual(TYPE_TO_ROLE, {
    opaque: 'base',
    air: 'air',
    metallic: 'metallic',
    technical: 'technical',
    wash: 'shade',
    contrast: 'contrast',
    ink: 'shade',
  });
});

test('buildPaint maps a source record to our schema', () => {
  const paint = buildPaint(SRC, 'ak_interactive/dark-grey-blue');
  assert.deepEqual(paint, {
    id: 'ak_interactive/dark-grey-blue',
    provider: 'ak_interactive',
    name: 'Dark Grey-Blue',
    normalized_name: 'dark grey blue',
    aliases: [],
    usage_roles: ['base'],
    color_families: ['blue'],
    rgb: { r: 59, g: 74, b: 90 },
    owned: false,
  });
});

test('buildPaint uses metallic family for metallic type', () => {
  const paint = buildPaint({ ...SRC, type: 'metallic', hex: '#B0A060' }, 'ak_interactive/x');
  assert.deepEqual(paint.usage_roles, ['metallic']);
  assert.deepEqual(paint.color_families, ['metallic']);
});

test('buildPaint maps ink type to shade role', () => {
  const paint = buildPaint({ ...SRC, type: 'ink' }, 'ak_interactive/y');
  assert.deepEqual(paint.usage_roles, ['shade']);
});

test('buildPaint throws on unknown type', () => {
  assert.throws(() => buildPaint({ ...SRC, type: 'varnish' }, 'ak_interactive/z'), /unknown ak type/i);
});

test('buildPaint throws on missing name or sku', () => {
  assert.throws(() => buildPaint({ ...SRC, name: '' }, 'id'), /missing name/i);
  assert.throws(() => buildPaint({ ...SRC, sku: '' }, 'id'), /missing sku/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ak-transform.test.mjs`
Expected: FAIL — `buildPaint`/`TYPE_TO_ROLE` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `scripts/ak-transform.mjs` (import `normalizeText` at top):

```javascript
import { normalizeText } from '../src/normalize.mjs';

export const TYPE_TO_ROLE = {
  opaque: 'base',
  air: 'air',
  metallic: 'metallic',
  technical: 'technical',
  wash: 'shade',
  contrast: 'contrast',
  ink: 'shade',
};

export function buildPaint(source, id) {
  if (!source.name) throw new Error('missing name');
  if (!source.sku) throw new Error('missing sku');
  const role = TYPE_TO_ROLE[source.type];
  if (!role) throw new Error(`unknown ak type: ${JSON.stringify(source.type)}`);
  const rgb = hexToRgb(source.hex);
  const color_families = source.type === 'metallic'
    ? ['metallic']
    : [classifyColorFamily(rgb)];
  return {
    id,
    provider: 'ak_interactive',
    name: source.name,
    normalized_name: normalizeText(source.name),
    aliases: [],
    usage_roles: [role],
    color_families,
    rgb,
    owned: false,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ak-transform.test.mjs`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/ak-transform.mjs tests/ak-transform.test.mjs
git commit -m "feat(ak): buildPaint record transform and type->role map"
```

---

### Task 3: Catalog assembly — `transformCatalog` (primer skip, collisions, sort)

**Files:**
- Modify: `scripts/ak-transform.mjs`
- Test: `tests/ak-transform.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/ak-transform.test.mjs`:

```javascript
import { transformCatalog } from '../scripts/ak-transform.mjs';

const RECORDS = [
  { name: 'White', sku: 'AK11001', type: 'opaque', hex: '#FFFFFF' },
  { name: 'Black', sku: 'AK11050', type: 'opaque', hex: '#101010' },   // collides
  { name: 'Black', sku: 'AK17000', type: 'ink', hex: '#0A0A0A' },      // collides
  { name: 'Primer Grey', sku: 'AK999', type: 'primer', hex: '#888888' }, // skipped
];

test('transformCatalog skips primers, disambiguates collisions, sorts by id', () => {
  const catalog = transformCatalog(RECORDS);
  assert.deepEqual(catalog.provider, { id: 'ak_interactive', name: 'AK Interactive' });
  const ids = catalog.paints.map((p) => p.id);
  assert.deepEqual(ids, [
    'ak_interactive/black-ak11050',
    'ak_interactive/black-ak17000',
    'ak_interactive/white',
  ]);
  // no primer present
  assert.equal(catalog.paints.some((p) => p.name === 'Primer Grey'), false);
});

test('transformCatalog keeps a clean slug when unique', () => {
  const catalog = transformCatalog([{ name: 'Lime Green', sku: 'AK1', type: 'opaque', hex: '#7CB342' }]);
  assert.equal(catalog.paints[0].id, 'ak_interactive/lime-green');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ak-transform.test.mjs`
Expected: FAIL — `transformCatalog` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `scripts/ak-transform.mjs`:

```javascript
export function transformCatalog(records) {
  const kept = records.filter((r) => r.type !== 'primer');

  const slugCounts = new Map();
  for (const r of kept) {
    const s = slugify(r.name);
    slugCounts.set(s, (slugCounts.get(s) || 0) + 1);
  }

  const paints = kept.map((r) => {
    const s = slugify(r.name);
    const id = slugCounts.get(s) > 1
      ? `ak_interactive/${s}-${String(r.sku).toLowerCase()}`
      : `ak_interactive/${s}`;
    return buildPaint(r, id);
  });

  paints.sort((a, b) => a.id.localeCompare(b.id));

  return {
    provider: { id: 'ak_interactive', name: 'AK Interactive' },
    paints,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ak-transform.test.mjs`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/ak-transform.mjs tests/ak-transform.test.mjs
git commit -m "feat(ak): transformCatalog with collision disambiguation"
```

---

### Task 4: Import CLI wrapper

**Files:**
- Create: `scripts/import-ak.mjs`

- [ ] **Step 1: Write the implementation**

```javascript
// scripts/import-ak.mjs
// Usage: node scripts/import-ak.mjs <source-dir> [output-file]
// <source-dir> must contain the 5 hobby AK files from alexparlett/hobby-desk-data:
//   ak_3gen.json ak_quick_gen.json ak_the_inks.json ak_acrylic_wash.json ak_deep_shades.json
import fs from 'node:fs/promises';
import path from 'node:path';

import { transformCatalog } from './ak-transform.mjs';

const SOURCE_FILES = [
  'ak_3gen.json',
  'ak_quick_gen.json',
  'ak_the_inks.json',
  'ak_acrylic_wash.json',
  'ak_deep_shades.json',
];

async function main() {
  const sourceDir = process.argv[2];
  const outFile = process.argv[3]
    || path.join(process.cwd(), 'data/catalog/ak_interactive.json');
  if (!sourceDir) {
    console.error('usage: node scripts/import-ak.mjs <source-dir> [output-file]');
    process.exit(1);
  }

  const records = [];
  for (const file of SOURCE_FILES) {
    const raw = await fs.readFile(path.join(sourceDir, file), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error(`${file}: expected a JSON array`);
    records.push(...parsed);
  }

  const catalog = transformCatalog(records);
  await fs.writeFile(outFile, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.error(`wrote ${catalog.paints.length} paints to ${outFile}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke-test the wrapper against a temp fixture**

Run:
```bash
mkdir -p /tmp/ak-smoke && cd /tmp/ak-smoke
for f in ak_3gen ak_quick_gen ak_the_inks ak_acrylic_wash ak_deep_shades; do echo '[]' > "$f.json"; done
node "$OLDPWD/scripts/import-ak.mjs" /tmp/ak-smoke /tmp/ak-smoke/out.json
cd "$OLDPWD"
```
Expected: prints `wrote 0 paints to /tmp/ak-smoke/out.json`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/import-ak.mjs
git commit -m "feat(ak): import-ak CLI wrapper"
```

---

### Task 5: Add `ak_interactive` overlay rules

**Files:**
- Modify: `data/overrides/product_formats.json`

- [ ] **Step 1: Add the rules**

Insert these objects into the `rules` array (after the existing `army_painter` rules, before the closing `]`). Each in-scope AK `usage_role` maps to a format:

```json
    { "match": { "provider": "ak_interactive", "usage_role": "base" }, "format": "opaque_base" },
    { "match": { "provider": "ak_interactive", "usage_role": "air" }, "format": "opaque_layer" },
    { "match": { "provider": "ak_interactive", "usage_role": "metallic" }, "format": "metallic" },
    { "match": { "provider": "ak_interactive", "usage_role": "technical" }, "format": "technical" },
    { "match": { "provider": "ak_interactive", "usage_role": "shade" }, "format": "wash" },
    { "match": { "provider": "ak_interactive", "usage_role": "contrast" }, "format": "contrast" }
```

Ensure the preceding rule object keeps its trailing comma and the JSON stays valid.

- [ ] **Step 2: Verify JSON validity and rule load**

Run:
```bash
node -e "import('./src/overrides.mjs').then(async m => { const o = await m.loadOverlay(); console.log('rules', o.rules.length); })"
```
Expected: prints a rule count that is 6 higher than before (no parse/format error thrown).

- [ ] **Step 3: Commit**

```bash
git add data/overrides/product_formats.json
git commit -m "feat(ak): product_format overlay rules for ak_interactive"
```

---

### Task 6: Generate the committed catalog from the pinned source

**Files:**
- Create: `data/catalog/ak_interactive.json` (generated, committed)

- [ ] **Step 1: Download the 5 source files at the pinned commit**

Run (uses `gh`, already authenticated):
```bash
REF=1bc4e0901442a9147d8a79547236a7e4170e4483
mkdir -p /tmp/ak-src
for f in ak_3gen ak_quick_gen ak_the_inks ak_acrylic_wash ak_deep_shades; do
  gh api "repos/alexparlett/hobby-desk-data/contents/ak-interactive/$f.json?ref=$REF" --jq '.content' | base64 -d > "/tmp/ak-src/$f.json"
done
ls -l /tmp/ak-src
```
Expected: 5 non-empty JSON files.

- [ ] **Step 2: Generate the catalog**

Run: `node scripts/import-ak.mjs /tmp/ak-src data/catalog/ak_interactive.json`
Expected: prints `wrote 613 paints to data/catalog/ak_interactive.json`.

- [ ] **Step 3: Spot-check the output**

Run:
```bash
node -e "const d=require('node:fs').readFileSync('data/catalog/ak_interactive.json','utf8');const j=JSON.parse(d);console.log(j.provider, j.paints.length, j.paints.some(p=>p.id.includes('-ak')))"
```
Expected: `{ id: 'ak_interactive', name: 'AK Interactive' } 613 true`.

- [ ] **Step 4: Commit**

```bash
git add data/catalog/ak_interactive.json
git commit -m "data(ak): AK Interactive catalog (613 hobby paints) from hobby-desk-data@1bc4e09"
```

---

### Task 7: Integration test — catalog loads and every AK paint resolves a format

**Files:**
- Create: `tests/ak-catalog.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/ak-catalog.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBuiltInCatalog } from '../src/catalog-data.mjs';

test('AK Interactive provider is present in the built-in catalog', async () => {
  const catalog = await loadBuiltInCatalog();
  assert.ok(catalog.providers.some((p) => p.id === 'ak_interactive'));
});

test('AK catalog has 613 paints', async () => {
  const catalog = await loadBuiltInCatalog();
  const ak = catalog.paints.filter((p) => p.provider === 'ak_interactive');
  assert.equal(ak.length, 613);
});

test('every AK paint resolves a non-null product_format', async () => {
  const catalog = await loadBuiltInCatalog();
  const unresolved = catalog.paints
    .filter((p) => p.provider === 'ak_interactive' && p.product_format == null)
    .map((p) => p.id);
  assert.deepEqual(unresolved, []);
});

test('every AK paint has valid required fields', async () => {
  const catalog = await loadBuiltInCatalog();
  for (const p of catalog.paints.filter((x) => x.provider === 'ak_interactive')) {
    assert.match(p.id, /^ak_interactive\//);
    assert.ok(p.name && p.normalized_name);
    assert.equal(p.usage_roles.length >= 1, true);
    assert.equal(p.color_families.length >= 1, true);
    assert.ok(Number.isInteger(p.rgb.r) && Number.isInteger(p.rgb.g) && Number.isInteger(p.rgb.b));
  }
});
```

- [ ] **Step 2: Run test to verify it passes**

(The catalog and rules already exist from Tasks 5–6, so this should pass immediately. If any AK paint is unresolved, the overlay rules in Task 5 are incomplete — fix there.)

Run: `node --test tests/ak-catalog.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all tests pass — no regression from adding a 4th provider.

- [ ] **Step 4: Commit**

```bash
git add tests/ak-catalog.test.mjs
git commit -m "test(ak): catalog integration — load, count, format resolution"
```

---

## Self-Review

**Spec coverage:**
- Source = hobby-desk-data @ pinned commit → Task 6. ✓
- 5 hobby files, 613 paints, primer skip → Tasks 3, 6, 7. ✓
- Provider `ak_interactive` / "AK Interactive" → Tasks 2, 3, 7. ✓
- Reproducible import script → Tasks 1–4. ✓
- Record transform (id/slug, normalized_name, rgb from hex, owned=false) → Task 2. ✓
- Collision disambiguation `slug-<sku>` → Task 3. ✓
- type→role→format mapping incl. ink→wash → Tasks 2, 5. ✓
- color_families from RGB + metallic special-case → Tasks 1, 2. ✓
- Overlay rules, no unresolved format → Tasks 5, 7. ✓
- Error handling (bad hex / missing name+sku) → Tasks 1, 2. ✓
- No network at test time (fixtures inline; download is a one-off generation step) → Tasks 1–4, 6. ✓

**Placeholder scan:** No TBD/TODO; all code shown in full. ✓

**Type consistency:** `slugify`, `hexToRgb`, `classifyColorFamily`, `TYPE_TO_ROLE`, `buildPaint(source, id)`, `transformCatalog(records)` used identically across tasks. Output schema matches `validatePaint` in `src/registry-store.mjs`. ✓
