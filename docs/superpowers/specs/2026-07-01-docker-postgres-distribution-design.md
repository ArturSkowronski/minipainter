# Docker + Postgres distribution — design

**Date:** 2026-07-01
**Status:** approved, in implementation

## Goal

Make warpaint easy to distribute: portable across environments (Docker + Postgres runs
anywhere) with one very-easy one-click deploy to a popular remote-MCP host (Render Blueprint,
which provisions the web service **and** a managed Postgres together). Inventory moves to the
database; the catalog stays as in-image files (upstream mirror, per CLAUDE.md).

## Decisions

- **Engine:** PostgreSQL (`pg`, pure-JS driver — clean on Alpine; works for compose, Render,
  Fly, any managed PG). No SQLite.
- **Scope:** inventory only (`owned` paint ids). Catalog remains `data/catalog/*.json` in the image.
- **Default stays file-mode:** when `DATABASE_URL` is unset the app behaves exactly as today
  (JSON inventory file). Backward compatible — local dev and the current Fly deploy are untouched.

## Architecture (single seam)

Every consumer already goes through `src/registry-store.mjs` (`loadRegistry` / `saveRegistry` /
`initRegistryIfMissing`). The inventory repository interface is
`{ load(), save(inv), initIfMissing(), mutate(fn) }` with `inv = { version: 1, owned: string[] }`.

- **New** `src/infrastructure/inventory/postgres-inventory-repository.mjs` — same interface,
  backed by a table `owned_paints(paint_id text primary key, added_at timestamptz default now())`.
  Takes an injected `pool` (a `pg.Pool`-shaped object) so it is unit-testable.
  - `load()` → `SELECT paint_id … ORDER BY paint_id` → `{ version: 1, owned }`.
  - `save(inv)` → transaction: `DELETE FROM owned_paints; INSERT …` (replace set).
  - `initIfMissing()` → `CREATE TABLE IF NOT EXISTS …` (idempotent); if empty, seed from
    `INVENTORY_JSON` env (mirrors the JSON repo's seeding).
  - `mutate(fn)` → transaction with `SELECT … FOR UPDATE` semantics (present for parity; unused today).
- **New** `src/infrastructure/inventory/pg-pool.mjs` — lazy singleton `pg.Pool` from `DATABASE_URL`.
- **Edit** `src/registry-store.mjs::getRepository()` — `DATABASE_URL` set → postgres repo, else json repo.
  No consumer changes.
- **Dependency:** `pg`. **Dev dependency:** `pg-mem` (in-memory Postgres) for tests — no container in `node --test`.

## Distribution

- `docker-compose.yml` — `db` (postgres:16-alpine, named volume `pgdata`, healthcheck) + `app`
  (build ., `depends_on: db healthy`, `DATABASE_URL`, `PORT`, `3000:3000`). `docker compose up` = full stack.
- `render.yaml` — Render Blueprint: a Docker web service + a managed Postgres, `DATABASE_URL`
  wired via `fromDatabase`. One-click "Deploy to Render" button in the README.
- `.env.example`, `.dockerignore` (keep image lean), README "Run with Docker" + "Deploy" sections,
  update `docs/deploy-fly.md` to mention the optional `DATABASE_URL` mode.
- `Dockerfile` unchanged in shape (npm ci installs `pg`); still `CMD node src/mcp-http-server.mjs`.

## Data flow

`docker compose up` → app waits for db healthy → `startHttpServer` → `initPaintRegistry` →
`registry-store.initRegistryIfMissing` → postgres repo creates the table + seeds → serves.
Inventory mutations (`/api/inventory`, MCP tools, CLI) persist to Postgres; catalog read from files.

## Error handling

- Postgres unreachable at boot → `depends_on: condition: service_healthy` orders startup; a
  short connect retry in `pg-pool` covers races. Malformed `DATABASE_URL` → clear thrown error.
- `save()`/`mutate()` run in transactions so a partial write never leaves a half-updated set.

## Testing

- Unit (pg-mem): repo contract — init creates table, load empty, save then load round-trips,
  seed from `INVENTORY_JSON`, save replaces the set.
- `registry-store` picks the postgres repo when `DATABASE_URL` is set (inject a fake pool).
- Existing 135 tests stay green (json path is default).
- **Real validation (hard gate):** `docker compose up -d`, then `/health`, `GET /api/inventory`,
  `PUT` a paint owned, restart the app container, confirm the owned paint persists in Postgres.

## Out of scope (deferred)

Multi-user / auth, catalog-in-DB, migrations framework (idempotent `CREATE TABLE IF NOT EXISTS`
is enough for one table). One-click targets other than Render (Railway/Fly) are trivial variants
of the same Docker+Postgres image and can be added later.
