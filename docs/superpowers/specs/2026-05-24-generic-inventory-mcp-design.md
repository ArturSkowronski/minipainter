# Generic Inventory MCP — Design

**Status:** Approved
**Date:** 2026-05-24
**Scope:** Self-hosted per user, single tenancy. No multi-tenant, no auth beyond a single deployment-scoped sync token.

## Problem

The MCP server (`src/mcp-http-server.mjs`, deployed on Fly.io as `warpaint-mcp`) has two pain points:

1. **Inventory delivery via env var** — `WARPAINT_INVENTORY_JSON` requires a Fly machine restart on every update, has Fly secret size limits, and forces a tight coupling between deployment config and runtime data.
2. **Branding bleeds into the MCP layer** — `warpaint` naming sits in server name, env vars, storage paths, and log strings. A fork has to rename, even though everything except the CLI itself is generic inventory/paint-domain logic.

## Non-goals

- Multi-tenant / multi-user serving on a single deployment.
- Authentication beyond a single bearer token shared per deployment.
- Architectural separation into a reusable `mcp-inventory-framework` package — kept as a possible future step if a real second use case emerges.
- Custom paints, mixes, per-user preferences, multi-inventory support — out of scope for this round.
- Renaming the project / CLI — `warpaint-cli` stays as the CLI brand.

## Design

### Part 1 — Inventory persistence layer

**Storage model:**

- Fly volume mounted at `/data`, containing `inventory.json`. Volume is created out-of-band (`fly volumes create inventory_data --size 1`); deployment instructions are added to README.
- `INVENTORY_PATH` env var resolves the storage path. Defaults:
  - Local: `~/.warpaint/inventory.json` (unchanged behavior).
  - Container (Fly): `/data/inventory.json`.
- `INVENTORY_JSON` env var is treated as a **seed only**: on startup, if `INVENTORY_PATH` is absent on disk, the seed (when present) is written there and that file becomes the source of truth. If the file already exists, the env var is ignored entirely — a warning is logged once on startup to flag the divergence. This preserves the "one-shot bootstrap via Fly secret" path while removing its read-only constraint, and avoids accidentally clobbering disk state on every deploy.
- `WARPAINT_INVENTORY_JSON` kept as an alias of `INVENTORY_JSON` for backward compatibility.

**Mutation path:**

- `saveRegistry` no longer skips writes when an env-seeded inventory was used. It always writes to `INVENTORY_PATH`.
- Existing MCP tools `inventory_mark_owned` / `inventory_mark_unowned` resume functioning on the deployed server (currently no-ops because of the env guard added earlier).

### Part 2 — Sync endpoints + auth

Two new HTTP endpoints on the MCP server:

- `POST /inventory` — body is the full inventory JSON (`{ version: 1, owned: [...] }`). Validates, writes to `INVENTORY_PATH`, reloads the in-memory registry. Returns the saved inventory.
- `GET /inventory` — returns the current inventory JSON.

Both require a bearer token from env `INVENTORY_SYNC_TOKEN`. If unset, the endpoints return 503 (sync disabled) so that an unconfigured deployment can't be silently overwritten.

Hot reload is in-process: after `POST /inventory` succeeds, the same `loadRegistry` path that runs at startup is re-executed, replacing the in-memory registry exposed to MCP tools.

### Part 3 — CLI sync command

CLI gains a `warpaint sync` subcommand group:

- `warpaint sync push --remote <url>` — pushes `~/.warpaint/inventory.json` to `<url>/inventory` with the configured token.
- `warpaint sync pull --remote <url>` — fetches `<url>/inventory` and overwrites local inventory (with a confirm prompt unless `--force`).

Remote config lives in `~/.warpaint/remotes.json`:

```json
{
  "version": 1,
  "remotes": {
    "default": {
      "url": "https://warpaint-mcp.fly.dev",
      "token": "..."
    }
  }
}
```

`--remote` accepts either a full URL or a named remote key. Default remote (if configured) is used when `--remote` is omitted.

### Part 4 — Branding cleanup

| Element | Before | After |
|---|---|---|
| MCP server name (handshake) | `"warpaint"` | env `MCP_SERVER_NAME`, default `paint-inventory` |
| Bootstrap env var | `WARPAINT_INVENTORY_JSON` | `INVENTORY_JSON` (legacy name accepted) |
| Sync token env | — | `INVENTORY_SYNC_TOKEN` |
| Storage path env | — | `INVENTORY_PATH` (default `~/.warpaint/inventory.json` local, `/data/inventory.json` on Fly) |
| Log strings | `"Warpaint MCP HTTP server"` | `"${MCP_SERVER_NAME} MCP on port X"` |
| Fly app name | `warpaint-mcp` | unchanged in this repo's `fly.toml` (this is the author's deployment); README documents the template fork flow |
| Tool names (`paint_search`, `inventory_*`, `match_*`) | unchanged | unchanged — these describe the **domain** (paint), not the **brand** (warpaint) |

What stays warpaint-branded: the CLI binary name, the repo name, the local config dir (`~/.warpaint/`). Those are the user-facing product.

## Phasing

1. **Inventory persistence layer** — volume + `INVENTORY_PATH` + seed-from-env + `saveRegistry` writes again. Tests for both seed and direct-file boot.
2. **Sync endpoints + auth** — `GET`/`POST /inventory` + token. Hot reload. Tests for happy path + auth failure + invalid body.
3. **CLI sync command** — `warpaint sync push/pull` + `remotes.json`. Tests for config parsing, push, pull, confirm prompt.
4. **Branding cleanup** — env var renames + aliases + log strings + README template section.

Each phase is independently shippable; user keeps a working deployment throughout. Phase 4 is purely cosmetic and can be skipped or deferred.

## Compatibility

- Existing deployment (env-only, no volume): keeps working. On first deploy with the new code, the env-seeded inventory is written to `/data/inventory.json`. Subsequent `fly secrets set WARPAINT_INVENTORY_JSON=...` calls re-seed only when the volume file is absent.
- Existing CLI users: no change unless they opt into `warpaint sync`.
- Existing MCP clients: no tool signature changes.

## Open questions

None blocking. To revisit if real second use case appears: architectural separation into `mcp-inventory-framework` + `warpaint` domain package.
