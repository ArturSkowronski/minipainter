# Warpaint Forge Ledger Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the current plain TUI and minimal README into a grimdark `Forge Ledger` presentation with reusable ASCII framing, reproducible screenshots, and a showcase-quality README.

**Architecture:** Keep the existing deterministic search and inventory core intact while extracting TUI presentation into focused rendering helpers. Add a small screenshot generation path that reuses real TUI and CLI output, then rewrite README around those generated assets instead of hand-maintained mock content.

**Tech Stack:** Node.js 25, ESM modules, `node:test`, local scripts, terminal text rendering, README Markdown, generated PNG or terminal capture assets

---

## Chunk 1: Forge Ledger TUI Rendering

### Task 1: Extract grimdark banner and frame primitives

**Files:**
- Create: `src/tui-banner.mjs`
- Create: `src/tui-frame.mjs`
- Modify: `src/tui.mjs`
- Test: `tests/tui.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add tests covering:
- banner rendering includes `WARPAINT`
- frame helpers produce boxed section headers
- rendered TUI contains the new themed labels such as `FORGE CATALOG` and `SELECTED PIGMENT`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tui.test.mjs`
Expected: FAIL because the current renderer does not include the new labels or banner output

- [ ] **Step 3: Write minimal implementation**

Implement:
- `src/tui-banner.mjs` for the reusable top banner ASCII
- `src/tui-frame.mjs` for boxed section helpers and separators
- minimal `src/tui.mjs` integration that swaps plain text headings for the new themed frame layout

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tui.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui-banner.mjs src/tui-frame.mjs src/tui.mjs tests/tui.test.mjs
git commit -m "feat: add forge ledger tui framing"
```

### Task 2: Redesign the TUI screen composition

**Files:**
- Modify: `src/tui.mjs`
- Test: `tests/tui.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add tests covering:
- status strip with view, result count, owned count, and search query
- detail panel labels `OWNED` or `MISSING`
- command strip label `RITUAL COMMANDS`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tui.test.mjs`
Expected: FAIL because the current TUI layout lacks the new strip and labels

- [ ] **Step 3: Write minimal implementation**

Update TUI composition so it renders:
- hero banner
- status strip
- two-column style body using frame helpers
- command strip with short command legend

Keep state logic intact and change only presentation where possible.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tui.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui.mjs tests/tui.test.mjs
git commit -m "feat: redesign tui as forge ledger"
```

## Chunk 2: Screenshot And Demo Asset Pipeline

### Task 3: Add reproducible terminal demo generation

**Files:**
- Create: `scripts/generate-demo-data.mjs`
- Create: `scripts/render-demo-output.mjs`
- Create: `tests/demo-render.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing tests**

Add tests covering:
- demo registry generation creates stable owned and catalog states
- rendered demo outputs contain expected banner or command text for screenshot use

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/demo-render.test.mjs`
Expected: FAIL because the demo scripts do not exist

- [ ] **Step 3: Write minimal implementation**

Implement scripts that:
- create deterministic demo registry content
- render hero/search/owned/cli text captures from real app code
- write outputs to a generated asset directory for later screenshot conversion

Add an npm script such as:
- `npm run generate:demo`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/demo-render.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-demo-data.mjs scripts/render-demo-output.mjs tests/demo-render.test.mjs package.json
git commit -m "feat: add reproducible demo generation"
```

### Task 4: Generate README screenshot assets

**Files:**
- Create: `docs/assets/hero.txt`
- Create: `docs/assets/search.txt`
- Create: `docs/assets/owned.txt`
- Create: `docs/assets/cli.txt`
- Optionally Create: `docs/assets/*.png`
- Modify: `scripts/render-demo-output.mjs`

- [ ] **Step 1: Write the failing verification**

Add or extend tests to verify:
- all required demo asset files are generated
- generated text assets include the expected section labels

- [ ] **Step 2: Run verification to confirm failure**

Run: `node --test tests/demo-render.test.mjs`
Expected: FAIL because the specific asset files are not yet created

- [ ] **Step 3: Write minimal implementation**

Generate the four required README assets:
- hero
- search
- owned
- cli

Prefer generated text captures first. If PNG generation is practical without heavy dependencies, generate PNG screenshots too; otherwise use fenced terminal captures in README based on generated text files.

- [ ] **Step 4: Run verification to confirm pass**

Run: `node --test tests/demo-render.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/assets scripts/render-demo-output.mjs tests/demo-render.test.mjs
git commit -m "feat: add forge ledger demo assets"
```

## Chunk 3: README Rewrite And Final Verification

### Task 5: Rewrite README around the Forge Ledger presentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-03-30-warpaint-forge-ledger-readme-design.md`

- [ ] **Step 1: Write the failing verification**

Add a test that checks:
- README references all required screenshot assets
- README includes hero, why, features, screenshots, quickstart, TUI workflow, and roadmap sections

- [ ] **Step 2: Run verification to confirm failure**

Run: `node --test tests/demo-render.test.mjs`
Expected: FAIL because the current README lacks the required structure and asset references

- [ ] **Step 3: Write minimal implementation**

Rewrite `README.md` to include:
- strong hero section and tagline
- product problem statement
- feature highlights
- embedded screenshot assets
- polished quickstart
- TUI workflow explanation
- forward-looking project direction
- technical notes

Update the design spec status to reflect that implementation exists.

- [ ] **Step 4: Run verification to confirm pass**

Run: `node --test tests/demo-render.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-03-30-warpaint-forge-ledger-readme-design.md tests/demo-render.test.mjs
git commit -m "docs: rewrite readme for forge ledger"
```

### Task 6: Full verification and polish pass

**Files:**
- Modify: `README.md`
- Modify: `src/tui.mjs`
- Modify: `src/tui-banner.mjs`
- Modify: `src/tui-frame.mjs`
- Modify: `tests/tui.test.mjs`
- Modify: `tests/demo-render.test.mjs`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 2: Regenerate demo assets**

Run: `npm run generate:demo`
Expected: all README demo assets are refreshed successfully

- [ ] **Step 3: Smoke-test the CLI and TUI presentation**

Run:
- `node src/cli.mjs catalog sync`
- `node src/cli.mjs paint search bone`
- `node src/cli.mjs inventory own "Abaddon Black"`
- `node src/cli.mjs tui`

Expected:
- human-readable CLI output looks polished
- TUI shows banner, framed sections, and command strip
- no obviously broken alignment at the recommended terminal width

- [ ] **Step 4: Commit**

```bash
git add README.md docs/assets src/tui.mjs src/tui-banner.mjs src/tui-frame.mjs tests/tui.test.mjs tests/demo-render.test.mjs
git commit -m "style: polish forge ledger presentation"
```
