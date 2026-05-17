# WARPAINT MCP

`warpaint-cli` exposes its paint catalog and inventory through the
[Model Context Protocol](https://modelcontextprotocol.io) so Claude (and other
MCP-aware clients) can search paints, inspect them, and update what you own.

The same set of tools is served over two transports:

| Transport | Binary | Use case |
|---|---|---|
| stdio | `warpaint-mcp` (`src/mcp-server.mjs`) | Claude Desktop on the same machine as the inventory file |
| Streamable HTTP | `warpaint-mcp-http` (`src/mcp-http-server.mjs`) | Claude mobile, web, or any remote client |

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
   `~/.warpaint/inventory.json`).
3. Add the server to Claude Desktop's MCP config:

```json
{
  "mcpServers": {
    "warpaint": {
      "command": "node",
      "args": ["/absolute/path/to/warpaint-cli/src/mcp-server.mjs"]
    }
  }
}
```

4. Restart Claude Desktop. The seven tools above appear under the `warpaint`
   server.

To point the stdio server at a non-default inventory file, pass `cwd` in the
MCP server entry or set the `WARPAINT_INVENTORY_PATH` env var on the spawned
process.

## Remote (HTTP) — Claude mobile / web

The HTTP transport is a single endpoint:

- `POST /mcp` — Streamable HTTP MCP, requires `Authorization: Bearer <token>`
- `GET /health` — returns `warpaint-mcp ok`, no auth

The server is stateless: each request creates a fresh transport and server
pair. There is no session ID and no SSE replay.

### Run locally

```bash
export WARPAINT_TOKEN=$(openssl rand -hex 32)
export PORT=8080
npm run mcp:http
```

Smoke test:

```bash
curl -s -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer $WARPAINT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Deploy

A minimal Fly.io recipe lives in [docs/deploy-fly.md](docs/deploy-fly.md). The
shipped `Dockerfile` and `fly.toml` mount a volume at `/data` so
`inventory.json` survives restarts.

### Connect Claude

In Claude (mobile, web, or desktop), add a custom MCP connector:

- URL: `https://<your-host>/mcp`
- Header: `Authorization: Bearer <your token>`

## Environment variables (HTTP server)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `WARPAINT_TOKEN` | yes | — | Bearer token; the server refuses to start without it |
| `PORT` | no | `8080` | TCP port |
| `HOST` | no | `0.0.0.0` | Bind address |
| `WARPAINT_INVENTORY_PATH` | no | `~/.warpaint/inventory.json` | Path to the inventory file |

## Auth model

The HTTP server enforces one static bearer token (`WARPAINT_TOKEN`). There is
no per-user identity yet — anyone with the token reads and writes the same
inventory. Treat the token like a password: rotate via `fly secrets set
WARPAINT_TOKEN=...` (or your hosting equivalent).

OAuth and per-user storage are planned but out of scope for the current
iteration.

## Sync vs. local CLI

The remote HTTP server and the local CLI each write to their own
`inventory.json`. They are not synced. If you toggle ownership on the
deployed instance from Claude mobile, your laptop's
`~/.warpaint/inventory.json` will not see the change until a sync layer is
added.

A proposed sync design (per-paint `updatedAt`, last-write-wins, tombstones for
unowned) is sketched in conversation notes — not yet implemented.

## Troubleshooting

- `401 unauthorized` — `Authorization` header missing or token mismatch.
  Compare with the value of `WARPAINT_TOKEN` on the server.
- `404 not_found` on a path other than `/mcp` / `/health` — only those two
  paths are served.
- `invalid_json` on `POST /mcp` — request body is not valid JSON.
- Claude shows no tools after connecting — confirm the URL ends with `/mcp`
  and that `GET /health` returns 200 from the same host.
- `WARPAINT_TOKEN is required. Refusing to start without auth.` — set the env
  var before starting `warpaint-mcp-http`.
