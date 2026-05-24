# Deploying warpaint-mcp to Fly.io

This is the minimal HTTP MCP transport so Claude (mobile/desktop) can connect
to your warpaint inventory as a remote MCP server.

## What gets deployed

- `src/mcp-http-server.mjs` exposes `POST /mcp` (MCP Streamable HTTP) and
  `GET /health`.
- Single bearer-token auth via `WARPAINT_TOKEN`.
- Inventory file is stored on a Fly volume at `/data/inventory.json`
  (set via `WARPAINT_INVENTORY_PATH`).
- Stateless MCP transport: each request gets a fresh server+transport.

This is single-user. OAuth and per-user storage come later.

## Prereqs

- `flyctl` installed and `fly auth login` done.
- You picked an app name (default in `fly.toml` is `warpaint-mcp`, which may be
  taken — change it before launch).

## First deploy

```sh
# 1. Claim app name (no deploy yet)
fly launch --no-deploy --copy-config --name <your-app-name>

# 2. Create the volume that will hold inventory.json
fly volumes create warpaint_data --region fra --size 1

# 3. Set the bearer token
fly secrets set WARPAINT_TOKEN="$(openssl rand -hex 32)"

# 4. Deploy
fly deploy

# 5. Note the URL (e.g. https://<your-app-name>.fly.dev) and the token value
fly secrets list   # token is hashed; if you forgot it, rotate with `fly secrets set`
```

## Smoke test

```sh
TOKEN=<your token>
APP=https://<your-app-name>.fly.dev

# Health
curl -s "$APP/health"

# MCP initialize
curl -s -X POST "$APP/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0","id":1,
    "method":"initialize",
    "params":{
      "protocolVersion":"2025-06-18",
      "capabilities":{},
      "clientInfo":{"name":"curl","version":"0"}
    }
  }'

# List tools
curl -s -X POST "$APP/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

## Connect Claude

In Claude (mobile or web) add a custom MCP connector:

- URL: `https://<your-app-name>.fly.dev/mcp`
- Auth header: `Authorization: Bearer <your token>`

## Known limitations of this iteration

- Single user, single token. Anyone with the token has full read/write.
- No sync with the local CLI yet — the deployed instance has its own
  `inventory.json` on the Fly volume, separate from `~/.warpaint/inventory.json`.
- Stateless transport: no SSE streaming of long-running tool results
  (warpaint tools are fast, so this is fine).

## Persistent Inventory (v2)

Inventory now lives on a Fly volume mounted at `/data`. Before the first deploy
that uses persistent storage, create the volume:

    fly volumes create inventory_data --size 1 --region arn

Pick a single region matching `primary_region` in `fly.toml`. After the volume
exists, deploy normally:

    fly deploy

The container reads `INVENTORY_PATH` (defaulted to `/data/inventory.json` in
the Docker image). If the file is absent, the server seeds it from
`INVENTORY_JSON` (or the legacy `WARPAINT_INVENTORY_JSON`) on first boot.

To bootstrap from your local inventory:

    fly secrets set INVENTORY_JSON="$(cat ~/.warpaint/inventory.json)"

After the first boot, the volume is the source of truth — the env var is
ignored on subsequent loads (a warning is logged). Use the sync CLI for
ongoing updates (see `warpaint sync --help`).
