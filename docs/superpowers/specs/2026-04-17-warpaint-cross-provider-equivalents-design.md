# Warpaint Cross-Provider Equivalents Design

Date: 2026-04-17
Status: Approved in chat, awaiting implementation plan

## Goal

Answer the question "what paint from another brand do I already own that I could substitute?" When a tutorial, video, or agent recommends a paint the user does not own, `warpaint-cli` should surface the closest substitute from the user's existing inventory.

## Scope

This design covers:

- a new `findEquivalents` service over the existing registry
- a dedicated CLI subcommand (`warpaint match equivalents`)
- passive enrichment of `paint show` (CLI and MCP)
- a new MCP tool (`paint_equivalents`)
- a repo-wide retrofit: `shade` and `contrast` usage roles are treated as equivalents in role-based filtering

This design does not cover:

- catalog expansion (more paints per provider)
- paint-set link parsing or image-based inventory fill
- same-provider "ladder" recommendations (e.g., a better layer for a given base)
- TUI integration — a future pass can add a panel backed by the same service

## Problem Framing

The user interaction target is owned-first substitution. When a paint X from provider A is recommended, the answer the user wants is "you already own paint Y from provider B that is close enough." If nothing owned qualifies, then — and only then — the answer becomes "here are unowned paints close to X you could consider."

This is distinct from bulk translation (translate a whole shopping list to one brand) and from browsing reference tables. Those are out of scope.

## Chosen Direction

### Matching definition

A paint Q is an equivalent of source paint P when:

1. Q is not P.
2. Q's provider differs from P's (unless `includeSameProvider` is opted in).
3. Some role in `Q.usage_roles` matches some role in `P.usage_roles` under role normalization, where `shade` and `contrast` are treated as the same role (both normalize to `wash`). All other roles compare as-is.
4. Euclidean RGB distance between `P.rgb` and `Q.rgb` is at most `maxDistance` (default 60).

### Ranking

Qualifying candidates are partitioned into `owned` and `rest`, each sorted ascending by distance with ties broken by `name.localeCompare`. Each list is truncated at `limit` (default 3).

### Output semantics

- If `owned` is non-empty, return `{ owned, alternatives: [] }`.
- Else return `{ owned: [], alternatives: rest }`.

This matches the user's decision: owned-first with a fallback to unowned only when nothing owned qualifies. The output shape is stable — consumers always read the same keys — but the fallback only populates when it is useful.

## Architecture

### New files

- `src/roles.mjs` — pure role helper. Exports `normalizeRole(role)` (maps `shade` and `contrast` to `wash`, pass-through otherwise) and `rolesMatch(a, b)` (equality after normalization).
- `src/equivalents-service.mjs` — new service. Exports `findEquivalents(registry, paintRef, options)`.

### Modified files

- `src/search-engine.mjs` — `matchesFilters` uses `rolesMatch` for the `usageRole` filter instead of direct `Array.includes`. Retrofit so existing CLI, MCP, and TUI paths that filter by role honor the shade↔contrast equivalence automatically. The `colorDistance` helper is exported so `equivalents-service.mjs` can reuse it without duplication.
- `src/commands/` — new file for the `match equivalents` subcommand; dispatch wired into `src/cli.mjs`. The existing `paint show` command handler is extended to append an "Equivalents you own" block when the source paint has owned equivalents, and to include `equivalents` in the `--json` payload.
- `src/mcp-tools.mjs` — register new `paint_equivalents` tool; extend the `paint_show` handler to attach `equivalents` to its response payload.
- `src/output.mjs` — one new renderer helper for the equivalents block, reusing the existing style (provider, role, distance, short hex).

### No changes needed

- `src/mcp-server.mjs` — reads the tool list from `mcp-tools.mjs`, no startup changes.
- `src/registry-store.mjs`, `src/inventory-service.mjs`, `src/paint-service.mjs` — existing boundaries are sufficient.

### Rule of thumb

Equivalents logic lives in exactly one place (`equivalents-service.mjs`). Role normalization lives in exactly one place (`roles.mjs`). Every surface (CLI command, `paint show` enrichment, MCP tool, future TUI panel) calls into the same service.

## Data Shapes

### `findEquivalents(registry, paintRef, options)`

`paintRef`: either a string (paint name, alias, or id — resolved through the existing `resolvePaint`) or an already-resolved paint object.

`options`:

- `maxDistance` (default `60`) — hard Euclidean RGB cutoff.
- `limit` (default `3`) — max results per section.
- `includeSameProvider` (default `false`) — when true, do not exclude the source provider from candidates.

Success return shape:

```
{
  source: { id, provider, name, usage_roles, color_families, rgb },
  owned:        [ { paint, distance }, ... ],
  alternatives: [ { paint, distance }, ... ],
  thresholds:   { maxDistance, limit, includeSameProvider }
}
```

Error shapes (propagated from `resolvePaint` for string inputs):

- `{ status: 'not_found', matches: [...] }`
- `{ status: 'ambiguous', matches: [...] }`

Edge cases:

- Source paint missing `rgb` (not expected with current schema): return `{ owned: [], alternatives: [], reason: 'source_missing_rgb' }` so consumers can surface a clear message.
- Empty registry or no qualifying candidates: empty `owned` and `alternatives`, no `reason` field.

## CLI Surface

### New subcommand

`warpaint match equivalents <paint-name> [flags]`

Flags:

- `--json` — structured output matching the `findEquivalents` return shape.
- `--max-distance <number>` — override threshold.
- `--limit <number>` — override per-section cap.
- `--include-same-provider` — include source provider in results.

Human text output, owned found:

```
Equivalents for: Mephiston Red (citadel) • role: base • rgb: 146,27,41

You own:
  - Dragon Red      (army_painter)  role: base   ≈ 25   #aa211f
```

Human text output, fallback to alternatives:

```
Equivalents for: Pallid Bone (army_painter) • role: layer • rgb: 209,193,157

Nothing owned qualifies within distance 60.

Alternatives:
  - Skeleton Horde  (citadel)       role: contrast ≈ 45   #aa8758
```

Not-found and ambiguous outputs reuse the existing `output.mjs` helpers already used by `paint show`.

Exit codes follow existing conventions: 0 for success (including "nothing qualified"), non-zero only for input errors (not found, ambiguous).

### `paint show` enrichment

After the existing detail block, call `findEquivalents(registry, paint.id)` with defaults. When the result has any `owned` entries, append:

```
Equivalents you own:
  - Dragon Red      (army_painter)  role: base   ≈ 25
```

When `owned` is empty, append nothing. The dedicated `match equivalents` command is where users go for unowned alternatives; `paint show` stays focused.

Under `--json`, extend the payload with an `equivalents` key holding the full `findEquivalents` return shape.

## MCP Surface

### New tool: `paint_equivalents`

Input schema (Zod, matching the style of existing tools):

```
{
  paint: string,
  max_distance: number optional,
  limit: number optional,
  include_same_provider: boolean optional
}
```

Response content is the JSON-stringified `findEquivalents` return shape. Not-found and ambiguous outcomes are returned explicitly via `{ status, matches }`, matching the pattern established by the existing tools.

The tool `description` is written agent-first: explicit that owned paints are returned before alternatives, that shade and contrast are treated as interchangeable, and that same-provider matches are excluded by default.

### `paint_show` enrichment

The existing `paint_show` handler attaches an optional `equivalents` field to its response payload, populated with the full `findEquivalents` return shape using default options. The field is absent when `paint_show` cannot resolve the source paint. This is additive: existing consumers that do not read `equivalents` are unaffected.

### No server changes

`src/mcp-server.mjs` discovers tools from `mcp-tools.mjs`; no startup changes required.

## Testing

Following the existing `node --test` pattern with one test file per module.

New test files:

- `tests/roles.test.mjs`
  - `normalizeRole` maps `shade` and `contrast` to `wash`; leaves `base`, `layer`, `metallic` untouched.
  - `rolesMatch` is true for shade↔contrast and shade↔shade; false for base↔shade.
- `tests/equivalents-service.test.mjs`
  - Owned-first: one owned cross-provider paint qualifies → returned in `owned`; `alternatives` empty.
  - Fallback: no owned qualifies → `owned` empty, `alternatives` populated from unowned.
  - Threshold: distance exactly at `maxDistance` included; beyond it excluded.
  - Limit: more than `limit` qualifying → truncated with closest kept.
  - Role merge: Citadel contrast paint is returned as an equivalent for an Army Painter shade source.
  - Same-provider exclusion: Citadel paints excluded for a Citadel source by default; included when flag set.
  - Source paint excluded from its own results.
  - Not-found and ambiguous inputs propagate status shapes.
  - Tie-break: equal distance → sorted by name.

Extended test files:

- `tests/search-engine.test.mjs` — new assertion: `{ usageRole: 'shade' }` filter returns contrast paints too (retrofit verification).
- `tests/cli.test.mjs` — `warpaint match equivalents <name>`: happy path, `--json`, not-found, `--include-same-provider`. `paint show` includes "Equivalents you own" block when owned equivalents exist; omits it when none.
- `tests/mcp-tools.test.mjs` — `paint_equivalents` tool: happy path, not-found, ambiguous. `paint_show` response includes the `equivalents` field with the expected shape.

Fixtures extend the in-memory registry used by existing tests; tests do not depend on shipped catalog JSON.

## Post-Implementation

If any of `docs/assets/*.txt` capture the `paint show` output verbatim, re-run `npm run generate:demo` and commit the regeneration only if output truly changed.

## Non-Goals

- No curated hand-authored equivalence tables in this pass. A future design can layer curated overrides on top of the color-distance baseline; the return shape is already structured to carry a `source: 'curated' | 'color'` tag if needed later.
- No cross-provider color calibration. RGB values remain approximate references, not printed-color guarantees.
- No reshaping of existing catalogs. Two providers with six paints each is a small dataset; sparse results early on are acceptable. Catalog growth is tracked separately via the paint-set link parsing roadmap item.
