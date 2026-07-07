# MINIPAINTER MCP

`minipainter` exposes its paint catalog and inventory through the
[Model Context Protocol](https://modelcontextprotocol.io) so Claude (and other
MCP-aware clients) can search paints, inspect them, and update what you own.

The same set of tools is served over two transports:

| Transport | Binary | Use case |
|---|---|---|
| stdio | `minipainter-mcp` (`src/mcp-server.mjs`) | Claude Desktop on the same machine as the inventory file |
| Streamable HTTP | `minipainter-mcp-http` (`src/mcp-http-server.mjs`) | Claude mobile, web, or any remote client |

Both wrap the same `createMcpServer()` factory in `src/mcp-tools.mjs`, so the
tool surface is identical.

## Tools

All tool results are returned as a single JSON text block plus
`structuredContent` for clients that prefer structured data.

### `paint_search`

Search the catalog by name, alias, provider, ownership, role, or color family.

| Field | Type | Required | Notes |
|---|---|---|---|
| `query` | string | no (default `""`) | Free-text query |
| `provider` | string | no | e.g. `citadel`, `army_painter` |
| `owned` | boolean | no | Filter to owned / not-owned only |
| `usage_role` | string | no | e.g. `speedpaint`, `wash` |
| `color_family` | string | no | e.g. `bone`, `red` |
| `initialize_registry` | boolean | no | Create the inventory file if missing |

### `paint_show`

Show one paint or return `ambiguous` / `not_found` with hints.

| Field | Type | Required |
|---|---|---|
| `paint` | string | yes |
| `provider` | string | no |
| `initialize_registry` | boolean | no |

### `inventory_list`

List the paints currently marked as owned.

| Field | Type | Required |
|---|---|---|
| `initialize_registry` | boolean | no |

### `inventory_mark_owned`

Mark a paint as owned.

| Field | Type | Required |
|---|---|---|
| `paint` | string | yes |
| `provider` | string | no |
| `initialize_registry` | boolean | no |

### `inventory_mark_unowned`

Mark a paint as not owned.

| Field | Type | Required |
|---|---|---|
| `paint` | string | yes |
| `provider` | string | no |
| `initialize_registry` | boolean | no |

### `match_color`

Rank paints by approximate distance from a target color, owned first.

| Field | Type | Required | Notes |
|---|---|---|---|
| `hex` | string | one of `hex` / `rgb` | e.g. `#d2c29b` |
| `rgb` | `{ r, g, b }` | one of `hex` / `rgb` | Integer 0-255 each |
| `provider` | string | no | |
| `owned` | boolean | no | |
| `usage_role` | string | no | |
| `color_family` | string | no | |
| `initialize_registry` | boolean | no | |

### `match_describe`

Rank paints from a semantic description such as `bone` or `silver metallic`.

| Field | Type | Required |
|---|---|---|
| `query` | string | yes |
| `provider` | string | no |
| `owned` | boolean | no |
| `usage_role` | string | no |
| `color_family` | string | no |
| `initialize_registry` | boolean | no |

## Local (stdio) — Claude Desktop

1. Install dependencies once: `npm install` in this repo.
2. Initialize the inventory: `node src/cli.mjs catalog sync` (creates
   `~/.minipainting/inventory.json`; legacy `~/.warpaint/` is auto-migrated on first run).
3. Add the server to Claude Desktop's MCP config:

```json
{
  "mcpServers": {
    "minipainter": {
      "command": "node",
      "args": ["/absolute/path/to/minipainter/src/mcp-server.mjs"]
    }
  }
}
```

4. Restart Claude Desktop. The seven tools above appear under the `minipainter`
   server.

To point the stdio server at a non-default inventory file, pass `cwd` in the
MCP server entry or set the `INVENTORY_PATH` env var on the spawned process.

## Remote (HTTP) — Claude mobile / web

The HTTP transport exposes three paths:

- `POST /mcp` — Streamable HTTP MCP. **No auth yet** — anyone with the URL
  can call tools. Use URL obscurity and network controls until per-user auth
  lands.
- `GET /health` — returns `{"status":"ok"}`, no auth.
- `GET`/`POST /inventory` — bearer-token-protected inventory sync. Requires
  `Authorization: Bearer <INVENTORY_SYNC_TOKEN>`. Returns `503` when the
  token env is not set on the server (sync is opt-in).

The MCP server is stateless: each request creates a fresh transport and
server pair. There is no session ID and no SSE replay.

### Run locally

```bash
export INVENTORY_SYNC_TOKEN=$(openssl rand -hex 32)
export PORT=3000
export INVENTORY_PATH=$HOME/.minipainting/inventory.json
npm run mcp:http
```

Smoke test:

```bash
# MCP tools/list (no auth)
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Read inventory
curl -s -H "Authorization: Bearer $INVENTORY_SYNC_TOKEN" \
     http://localhost:3000/inventory

# Push a new inventory
curl -s -X POST http://localhost:3000/inventory \
     -H "Authorization: Bearer $INVENTORY_SYNC_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"version":1,"owned":["army_painter/holy-white"]}'
```

### Sync from the CLI

The `mpaint` CLI ships a sync subcommand that pushes/pulls inventory to/from
the deployed MCP. One-time setup:

```bash
mpaint sync add default \
  --url https://<your-host> \
  --token <INVENTORY_SYNC_TOKEN>
```

Then:

```bash
mpaint sync push              # upload local → remote
mpaint sync pull --force      # overwrite local from remote
```

Remote config lives in `~/.minipainting/remotes.json`.

### Deploy

The Fly.io recipe lives in [docs/deploy-fly.md](docs/deploy-fly.md). The
shipped `Dockerfile` and `fly.toml` mount a volume at `/data` so
`inventory.json` survives restarts. `INVENTORY_PATH` is preset to
`/data/inventory.json` in the image.

### Connect Claude

In Claude (mobile, web, or desktop), add a custom MCP connector:

- URL: `https://<your-host>/mcp`

No `Authorization` header is needed for `/mcp` at the moment.

## Environment variables (HTTP server)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `INVENTORY_SYNC_TOKEN` | for `/inventory` | — | Bearer token protecting `GET`/`POST /inventory`; when unset, the endpoint returns 503 (sync disabled) |
| `INVENTORY_PATH` | no | `~/.minipainting/inventory.json` locally, `/data/inventory.json` in the Docker image | Path to the inventory file |
| `INVENTORY_JSON` | no | — | One-time seed JSON; written to disk only if `INVENTORY_PATH` is absent on boot, ignored on subsequent loads (a warning is logged) |
| `WARPAINT_INVENTORY_JSON` | no | — | Legacy alias for `INVENTORY_JSON` |
| `MCP_SERVER_NAME` | no | `paint-inventory` | Name shown in MCP handshake and startup log |
| `PORT` | no | `3000` | TCP port |

## Auth model

- `/mcp` — currently unauthenticated. Per-user OAuth is planned, out of scope
  for this iteration.
- `/inventory` — single shared bearer token via `INVENTORY_SYNC_TOKEN`. Anyone
  with the token reads and writes the same inventory. Treat the token like a
  password: rotate via `fly secrets set INVENTORY_SYNC_TOKEN=...`.

## Persistence model

`INVENTORY_PATH` is the source of truth. `INVENTORY_JSON` is a seed used only
when the file doesn't exist on boot — once the file is written, the env var
is ignored on subsequent loads (a warning is logged). Tool calls
(`inventory_mark_owned`, `inventory_mark_unowned`) and `POST /inventory` both
write to `INVENTORY_PATH` atomically (tmp + rename).

`POST /inventory` triggers a server-side reload of the registry after the
write. If the reload fails (schema problem in the pushed body), the response
is 500 with a clear message — the disk has the new data but the live server
sees a stale registry until restart.

## Troubleshooting

- `401 unauthorized` on `/inventory` — `Authorization` header missing or
  token mismatch. Compare with `INVENTORY_SYNC_TOKEN` on the server.
- `503 sync disabled` on `/inventory` — `INVENTORY_SYNC_TOKEN` is not set on
  the server. Set it (and redeploy / restart) to enable sync.
- `404 Not Found` on a path other than `/mcp` / `/health` / `/inventory` —
  only those three paths are served.
- `400 invalid JSON body` on `POST /inventory` — request body is not valid
  JSON. Validate with `jq` first.
- `400 invalid inventory shape` on `POST /inventory` — body parses but
  doesn't match `{ version: 1, owned: string[] }`.
- `500 inventory persisted but registry reload failed; restart the server` —
  POST wrote the file successfully, but reloading it into the live registry
  failed. Disk is the source of truth; restart the server to recover.
- Claude shows no tools after connecting — confirm the URL ends with `/mcp`
  and that `GET /health` returns 200 from the same host.
