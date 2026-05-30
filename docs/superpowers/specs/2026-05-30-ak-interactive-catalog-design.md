# AK Interactive catalog — design

**Date:** 2026-05-30
**Status:** Approved for planning
**Goal:** Add an AK Interactive paint catalog (`data/catalog/ak_interactive.json`) sourced from the same upstream as the existing catalogs, plus the overlay rules needed to give every AK paint a `product_format`.

## Context

`data/catalog/{citadel,army_painter,vallejo}.json` are an upstream mirror and must never be hand-edited; corrections live in `data/overrides/product_formats.json` (see catalog-discipline). The original import/transform script that produced these files is **not** present in the repo, and the source repo URL was never recorded.

Search established that the catalogs' exact RGB values do not match any public GitHub repo, but the structurally-canonical upstream — per-brand, per-range, scraper-driven, refreshable — is **[`alexparlett/hobby-desk-data`](https://github.com/alexparlett/hobby-desk-data)** ("Hobby Desk" ≈ "Workbench"). The user accepted it as the canonical source for AK. Pinned source commit: `1bc4e0901442a9147d8a79547236a7e4170e4483`.

Because RGB sampling differs from the existing catalogs' (unknown) source, AK RGB will come straight from hobby-desk-data `hex` fields. This is accepted.

## Scope

Import the **hobby (miniature) AK ranges** only — Real Colors (lacquers) and marker products are excluded.

| hobby-desk-data file | kept | AK `type`s |
|---|---|---|
| `ak-interactive/ak_3gen.json` | 476 | opaque, air, metallic, technical (primer skipped) |
| `ak-interactive/ak_quick_gen.json` | 80 | contrast, technical |
| `ak-interactive/ak_the_inks.json` | 28 | ink |
| `ak-interactive/ak_acrylic_wash.json` | 19 | wash |
| `ak-interactive/ak_deep_shades.json` | 10 | technical, wash |

**Total: 613 paints.** Source data verified: 0 missing/invalid hex, 0 discontinued, all have `sku`.

`type: primer` records are **skipped** (1 in 3rd Gen). Real Colors / markers / varnish are out of scope.

## Provider

```
{ "id": "ak_interactive", "name": "AK Interactive" }
```
Convention follows `army_painter` (snake_case id).

## Architecture

Add a **reproducible import script** `scripts/import-ak.mjs` so the catalog stays a refreshable mirror rather than hand-authored JSON. The script:

1. Reads the 5 AK source files. Default mode reads from a local checkout / fixtures dir passed as an argument; it does **not** require network at test time. (For a live refresh, the maintainer points it at raw hobby-desk-data files at the pinned commit.)
2. Filters out `type: primer`.
3. Transforms each record to our paint schema (below).
4. Writes `data/catalog/ak_interactive.json` sorted by `id`, matching the existing files' shape (`{ provider, paints: [...] }`).

The script is the source of truth for the transform; the committed JSON is its output. Corrections to mistagged paints go to `data/overrides/`, never to the generated file.

### Record transform

Source record (hobby-desk-data) → our schema:

| our field | derivation |
|---|---|
| `id` | `ak_interactive/<slug>`; for names whose slug collides across the kept set, `ak_interactive/<slug>-<sku-lowercased>` for **all** members of that collision group (deterministic, refresh-stable) |
| `provider` | `"ak_interactive"` |
| `name` | source `name` |
| `normalized_name` | `normalizeText(name)` from `src/normalize.mjs` |
| `aliases` | `[]` |
| `usage_roles` | mapped from source `type` (table below) |
| `color_families` | derived from RGB (classifier below) |
| `rgb` | parsed from source `hex` (`#RRGGBB` → `{r,g,b}`) |
| `owned` | `false` |

`slug(name)` = lowercase, non-alphanumeric runs → `-`, trimmed. (27 collision groups exist; the source `sku` disambiguates.)

### `type` → `usage_role` → `product_format`

`usage_roles` use the existing cross-brand vocabulary so the equivalents engine keeps working. Overlay rules (added to `data/overrides/product_formats.json`, `provider: ak_interactive`) resolve the format:

| AK `type` | `usage_role` | `product_format` | rationale |
|---|---|---|---|
| opaque | base | opaque_base | general opaque acrylic |
| air | air | opaque_layer | matches existing `army_painter air → opaque_layer` |
| metallic | metallic | metallic | |
| technical | technical | technical | |
| wash | shade | wash | shade ≡ wash |
| contrast | contrast | contrast | Quick Gen = transparent one-coat |
| ink | shade | wash | transparent ink → wash (user decision) |
| primer | — | — | record skipped, not imported |

No `varnish` type in scope (Real Colors excluded). Every imported paint resolves a non-null `product_format`.

### `color_families` classifier

No `colourRange` field exists in AK source, so families are derived from RGB. This is **approximate and only feeds search/browse — it never influences `product_format`.**

- `type: metallic` → `["metallic"]`
- otherwise an HSL-based hue classifier into the core subset of the existing vocabulary: `white, black, grey, red, orange, yellow, green, blue, purple, brown, pink`.
- Rules: very low lightness → `black`; very high lightness + low saturation → `white`; low saturation mid lightness → `grey`; else by hue bucket, with the orange/low-value region → `brown`.

Richer upstream-only families (bone, khaki, leather, skin, gold, silver, steel, teal, copper, bronze) are **not** reproduced; this is a known, accepted gap for a derived classifier.

## Error handling

- Import aborts with a clear error if any kept record has a missing/unparseable `hex` or missing `name`/`sku` (source currently clean, but the script must not emit invalid records).
- Generated JSON is validated against `validatePaint` semantics implicitly by the existing registry load path; a test asserts the whole AK file loads and every paint resolves a `product_format`.

## Testing

- `tests/import-ak.test.mjs`: transform unit tests against a small fixture — slug collision disambiguation, primer skip, hex→rgb, each `type`→`usage_role`, color-family edge cases (pure black/white/grey/red).
- Catalog-level assertion: load the built-in catalog, confirm `ak_interactive` provider present, 613 paints, and **no** AK paint has `product_format: null` (overlay rules complete).
- Existing test suite must stay green (catalog now has a 4th provider).

## Out of scope

- AK Real Colors, markers, varnishes.
- Reproducing upstream-only `color_families`.
- Matching the existing catalogs' RGB sampling (different source).
- Any network fetch at test/CI time.
