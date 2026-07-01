# Deploying warpaint-mcp to Fly.io

This is the HTTP MCP transport so Claude (mobile/desktop) can connect to your
inventory as a remote MCP server.

## What gets deployed

- `src/mcp-http-server.mjs` exposes:
  - `POST /mcp` (MCP Streamable HTTP) — unauthenticated; use URL obscurity for now
  - `GET /health` — liveness probe
  - `GET`/`POST /inventory` — bearer-token-protected inventory sync
- Inventory file is stored on a Fly volume at `/data/inventory.json` (path
  controlled by `INVENTORY_PATH`).
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
fly volumes create inventory_data --region arn --size 1

# 3. Set the sync bearer token (used by /inventory endpoint)
fly secrets set INVENTORY_SYNC_TOKEN="$(openssl rand -hex 32)"

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

# MCP initialize (no auth)
curl -s -X POST "$APP/mcp" \
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

# List tools (no auth)
curl -s -X POST "$APP/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# Read inventory (auth required)
curl -s -H "Authorization: Bearer $TOKEN" "$APP/inventory"
```

## Connect Claude

In Claude (mobile or web) add a custom MCP connector:

- URL: `https://<your-app-name>.fly.dev/mcp`

The `/mcp` endpoint currently has no authentication. Use URL obscurity and
Fly's network controls until per-user auth lands.

## ChatGPT connector endpoint (v3)

`POST /mcp/v3` is a second MCP endpoint shaped for the OpenAI ChatGPT connector
contract. It exposes `search`, `fetch`, and `match_color` (the existing `/mcp`
with the 7 paint tools is unchanged, for Claude).

- `search({query})` → `{"results":[{"id","title","url"}]}`
- `fetch({id})` → `{"id","title","text","url","metadata"}`

Result `url`s are built from `PUBLIC_BASE_URL` (default
`https://warpaint-mcp.fly.dev`), pointing at `GET /api/paints/<id>`. Set it if the
app is deployed under a different hostname:

    fly secrets set PUBLIC_BASE_URL="https://<your-app-name>.fly.dev"

Add it in ChatGPT as a custom connector pointing at `https://<app>.fly.dev/mcp/v3`.

Smoke test against a live deploy:

    APP=https://warpaint-mcp.fly.dev
    curl -s -X POST "$APP/mcp/v3" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"query":"nuln oil"}}}'

> Follow-up: versioning across `/mcp` and `/mcp/v3` will be unified into a single
> coherent `/mcp/vN` scheme in a later change.

## Postgres mode (portable deploys)

Setting `DATABASE_URL` switches inventory storage from the JSON file/volume to Postgres — the
same code path, chosen at runtime (`src/registry-store.mjs`). This is what `docker compose up`
and the Render Blueprint (`render.yaml`) use, and it works on Fly too:

    fly postgres create --name warpaint-db
    fly postgres attach warpaint-db   # sets DATABASE_URL as a secret

With `DATABASE_URL` set, the app creates the `owned_paints` table on boot and seeds it from
`INVENTORY_JSON` once if empty. Without it, the volume-backed JSON file is used exactly as
before. For a turnkey stack elsewhere, prefer `docker compose up` (see the README).

## Known limitations of this iteration

- `/mcp` is unauthenticated — anyone with the URL can call tools.
- `/inventory` is protected by a single shared bearer token.
- Stateless transport: no SSE streaming of long-running tool results
  (minipainting tools are fast, so this is fine).

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

    fly secrets set INVENTORY_JSON="$(cat ~/.minipainting/inventory.json)"

After the first boot, the volume is the source of truth — the env var is
ignored on subsequent loads (a warning is logged). Use the sync CLI for
ongoing updates (see `minipainting sync --help`).
