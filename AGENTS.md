# AGENTS.md — minipainter project guide for coding agents

A CLI + TUI + MCP servers (Claude and ChatGPT) for managing a miniature-paint inventory and
doing owned-first cross-brand paint matching over a catalog of 1,607 paints. Node.js, ESM,
tested with the built-in runner (`npm test` → `node --test`).

Humans: see `README.md`. `CLAUDE.md` carries the same paint-catalog rules and takes precedence.

## Setup

```sh
npm install          # Node.js 20+ (the Docker image uses node:22-alpine)
```

No build step — everything runs straight from `src/` (`.mjs`, native ESM).

## Commands

```sh
npm test                          # whole suite: node --test over tests/*.test.mjs
node src/cli.mjs --help           # CLI entry point
node src/cli.mjs paint search bone
node src/cli.mjs inventory own "Abaddon Black"
node src/cli.mjs match color "#d2c29b"
node src/cli.mjs tui              # colored terminal UI (honors NO_COLOR)
node src/cli.mjs catalog lint     # fails if any paint has a null product_format
npm run generate:demo            # regenerate docs/assets/*.svg TUI captures
```

- `node src/mcp-server.mjs` — MCP over stdio (Claude Desktop).
- `node src/mcp-http-server.mjs` — HTTP server on `PORT` (default 3000): `/mcp`, `/mcp/v3`
  (ChatGPT `search`/`fetch`/`match_color`), `/health`, `/api/*`.

**Always run `npm test` before finishing; keep it green.** Tests use `import test from 'node:test'`
+ `node:assert/strict`. External services in tests use in-memory fakes (`pg-mem` for Postgres) —
`npm test` must never need a real database or network.

## Storage (inventory)

Chosen at runtime in `src/registry-store.mjs`:

- `DATABASE_URL` set → **Postgres** (`owned_paints` table). Used by Docker / Render / Fly.
- unset → **JSON file** (`~/.minipainting/inventory.json` locally, `/data/inventory.json` in Docker).

Only the inventory (owned paint ids) is in the database; the catalog is always in-image files.

## Run the full stack (Docker + Postgres)

```sh
docker compose up --build         # app + postgres:16; inventory persists in the pgdata volume
```

Inventory survives container restart and `docker compose down`/recreate (only `down -v` wipes it).

## Deploy

- Fly.io (reference deploy `warpaint-mcp.fly.dev`, Fly Managed Postgres): `docs/deploy-fly.md`.
- One-click Render Blueprint: `render.yaml` (web service + managed Postgres, `DATABASE_URL` wired).
- Any Docker + Postgres host works via `docker-compose.yml`.

## Code layout & conventions

- ESM only (`.mjs`). Keep **pure logic** (transforms, predicates, search) separate from **I/O**;
  files stay small and focused.
- `src/application/` (use-cases), `src/infrastructure/` (repositories, config), `src/commands/`
  (CLI), `src/transports/` (http). Add tests alongside changes in `tests/`.
- Match the style of the file you edit. Conventional-commit messages. Branch before committing;
  don't push or commit unless asked. Use `gh` for GitHub.

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
