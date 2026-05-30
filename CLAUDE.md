# minipainting-cli — project guide for Claude

A CLI + MCP server for managing a miniature-paint inventory and doing cross-brand
paint matching. Node.js ESM, tested with the built-in runner (`npm test` → `node --test`).

## Paint catalog architecture

Paint data lives in two layers — **never** conflate them:

- **`data/catalog/*.json`** — one file per brand (`citadel`, `army_painter`, `vallejo`,
  `ak_interactive`). These are an **upstream mirror** and must **not** be hand-edited; they
  are refreshable/regenerable. Each paint:
  `{ id, provider, name, normalized_name, aliases, usage_roles, color_families, rgb, owned }`.
- **`data/overrides/product_formats.json`** — an overlay that maps `(provider, usage_role)`
  → normalized `product_format` (`opaque_base | opaque_layer | wash | contrast | technical |
  drybrush | metallic`). Brand rules are matched in order (first wins); per-id `overrides`
  win over rules. `src/overrides.mjs::enrichPaint` attaches `product_format` at load time.

### Rules
- To correct a mistagged paint, add a per-id entry in `data/overrides/`, **never** edit the catalog.
- For cross-brand reasoning read `paint.product_format` — do **not** infer product type from
  `usage_roles` or RGB. Predicates live in `src/paint-format.mjs`.
- `color_families` is an **approximate** RGB/HSL classification for search/browse only; it never
  influences `product_format`.
- After any catalog refresh, run `catalog lint` (the CLI command) — it fails if any paint has a
  null `product_format`, i.e. an unresolved overlay rule.

## Upstream source ("Workbench")

The upstream is the GitHub repo **[`alexparlett/hobby-desk-data`](https://github.com/alexparlett/hobby-desk-data)**
— scraper-driven, organized per-brand/per-range (e.g. `ak-interactive/ak_3gen.json`,
`games-workshop/citadel.json`). Its records look like
`{ brand, name, sku, type, hex, range, category, discontinued }`; our catalog schema is produced
by a transform on top of that.

### Adding / refreshing a brand catalog
1. Import from the matching `hobby-desk-data` folder via a transform script
   (see `scripts/ak-transform.mjs` for the pure transform and `scripts/import-ak.mjs` for the
   I/O wrapper — `node scripts/import-ak.mjs <source-dir> [out-file]`). **Pin the source commit.**
2. Write deterministic ids (`<provider>/<slug>`, disambiguating name collisions with `-<sku>`).
3. Add overlay rules in `data/overrides/product_formats.json` so every new paint resolves a
   `product_format`; verify with `catalog lint`.

Caveat: the RGB in the pre-existing `citadel/army_painter/vallejo` catalogs does **not** match
hobby-desk-data (different swatch sampling), and the original import script for those isn't in the
repo. hobby-desk-data is the **canonical upstream going forward** (used for the AK Interactive
catalog, pinned to `1bc4e09`); expect RGB drift versus the older catalogs.

## Conventions
- ESM (`.mjs`), `import test from 'node:test'` + `node:assert/strict`.
- Pure logic (transforms, predicates) separated from I/O; keep files focused.
- Run `npm test` before finishing; keep it green.
