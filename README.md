# WARPAINT

> Forge Ledger for the painting bench.

Site: [arturskowronski.github.io/warpaint-cli](https://arturskowronski.github.io/warpaint-cli/)

`warpaint-cli` is a local-first paint registry for Warhammer hobby workflows. It exists for one practical reason: AI paint suggestions are much more useful when they understand the paints you actually own.

The project gives you:

- a deterministic local catalog and inventory
- owned-first paint lookup and color matching
- a grimdark TUI with a strong ASCII presentation
- a CLI surface designed for both humans and future agent workflows

## Hero

The TUI is designed as a `Forge Ledger`: heavy terminal framing, bold ASCII, and paint data presented like a workshop inventory instead of a spreadsheet.

```text
See: docs/assets/hero.txt
```

![WARPAINT Forge Ledger Hero](docs/assets/hero.svg)

## Why This Exists

Most paint advice workflows break at the same point: they recommend paints you do not have on hand.

`warpaint-cli` is built to solve that exact problem:

- keep a local record of what is in your paint rack
- search it quickly by name, role, family, and approximate color
- prepare a stable inventory foundation for a future AI skill that can inspect links, photos, and model images

The long-term goal is not “AI picks random colors for miniatures.” The goal is “AI reasons from your actual inventory first, then suggests stronger alternatives only when useful.”

## Feature Highlights

- `Owned-first matching`: lookups and recommendations can prioritize paints you already have.
- `Catalog in repo, inventory in your home`: paint records live in `data/catalog/`; what you own lives in `~/.warpaint/inventory.json` and follows you across projects.
- `RGB-aware search`: approximate RGB values help with nearest-color matching.
- `Forge Ledger TUI`: terminal UI styled as a grimdark inventory ledger.
- `Agent-friendly CLI`: deterministic command output for future AI integration.

## Screenshots

### Hero Screen

Full-screen TUI with banner, catalog, detail panel, and command strip.

```text
See: docs/assets/hero.txt
```

![Hero Screen](docs/assets/hero.svg)

### Search View

Filtered lookup for a semantic search like `bone`.

```text
See: docs/assets/search.txt
```

![Search View](docs/assets/search.svg)

### Owned View

Inventory-only presentation focused on what is already bound to your collection.

```text
See: docs/assets/owned.txt
```

![Owned View](docs/assets/owned.svg)

### CLI Flow

Representative command-line usage for search, ownership updates, and color matching.

```text
See: docs/assets/cli.txt
```

![CLI Flow](docs/assets/cli.svg)

## Install

`warpaint-cli` is not published to npm. Clone the repo and install dependencies:

```bash
git clone https://github.com/ArturSkowronski/warpaint-cli.git
cd warpaint-cli
npm install
```

Requirements:

- Node.js 20 or newer
- POSIX-ish shell (Linux, macOS, WSL)

Optional: expose the binaries on your `PATH` so you can call `warpaint` from anywhere:

```bash
npm link
warpaint --help
```

Initialize the local inventory once (creates `~/.warpaint/inventory.json`):

```bash
node src/cli.mjs catalog sync
```

After that you have three usage modes:

- **CLI / TUI** — see Quickstart below
- **Local MCP for Claude Desktop** — see [Claude Desktop MCP Setup](#claude-desktop-mcp-setup)
- **Remote MCP for Claude mobile/web** — see [Remote MCP](#remote-mcp-claude-mobile)

## Quickstart

Initialize the local inventory at `~/.warpaint/inventory.json`:

```bash
node src/cli.mjs catalog sync
```

Search paints:

```bash
node src/cli.mjs paint search black
node src/cli.mjs paint search bone --json
```

Inspect one paint:

```bash
node src/cli.mjs paint show "Abaddon Black" --json
```

Mark paints as owned or missing:

```bash
node src/cli.mjs inventory own "Abaddon Black"
node src/cli.mjs inventory unown "Abaddon Black"
node src/cli.mjs inventory list
```

Run semantic or color matching:

```bash
node src/cli.mjs match describe bone
node src/cli.mjs match color "#d2c29b"
```

Launch the TUI:

```bash
node src/cli.mjs tui
```

Run the MCP server locally:

```bash
node src/mcp-server.mjs
```

## TUI Workflow

The TUI is centered around three presentation areas:

- `FORGE CATALOG`: visible paints in the current scope
- `SELECTED PIGMENT`: the currently highlighted paint with provider, families, usage, and RGB
- `RITUAL COMMANDS`: the command legend for the active session

Current TUI commands:

- `search <text>`
- `owned`
- `catalog`
- `toggle`
- `quit`

Recommended use:

1. start with `catalog`
2. narrow with `search bone`, `search black`, or similar queries
3. inspect the selected pigment panel
4. toggle ownership as your collection changes

## Project Direction

Implemented now:

- local JSON registry
- starter provider catalogs for Citadel and Army Painter
- owned / missing inventory tracking
- deterministic search and color matching
- grimdark terminal presentation
- local MCP server for Claude Desktop

Planned later:

- a separate skill for parsing paint-set links
- image-driven inventory fill from paint bottle photos
- model-photo analysis that recommends owned paints first
- stronger cross-provider equivalents and matching hints

## Technical Notes

- Built-in catalog data lives in `data/catalog/` (Citadel and Army Painter, kept in version control)
- Inventory file: `~/.warpaint/inventory.json` — stores only owned paint ids in the form `{ "version": 1, "owned": ["citadel/abaddon-black", ...] }`
- The catalog and inventory are composed at runtime; saving never rewrites the catalog
- IDs are stable by convention (provider + name slug); on load, owned ids missing from the catalog are reported as warnings instead of being silently dropped
- A pre-existing project-local `.warpaint/registry.json` next to the inventory path is auto-migrated on first run
- Override the inventory location at the API surface with `{ inventoryPath }` or `{ cwd }` (the latter resolves to `<cwd>/.warpaint/inventory.json`, which is what the test suite uses for isolation)
- RGB values are approximate reference colors for matching, not a guarantee of final painted appearance
- MCP entrypoint: `node src/mcp-server.mjs`
- MCP helper script: `npm run mcp`
- README demo captures are reproducible via:

```bash
npm run generate:demo
```

## Claude Desktop MCP Setup

`warpaint-cli` now includes a local MCP server so Claude Desktop can use your paint registry directly.

Example local MCP config:

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

After adding the server, Claude Desktop can call tools such as:

- `paint_search`
- `paint_show`
- `inventory_list`
- `inventory_mark_owned`
- `inventory_mark_unowned`
- `match_color`
- `match_describe`

Suggested local flow:

1. initialize your registry once with `node src/cli.mjs catalog sync`
2. add the MCP server to Claude Desktop
3. ask Claude to search paints or update ownership through the exposed tools

## Remote MCP (Claude Mobile)

For Claude mobile or web, the stdio MCP server above is not reachable. Run
`warpaint-mcp-http` instead — a Streamable HTTP MCP transport exposing the
same tools behind a bearer token.

### Local smoke test

```bash
export WARPAINT_TOKEN=$(openssl rand -hex 32)
export PORT=8080
export WARPAINT_INVENTORY_PATH=$HOME/.warpaint/inventory.json
npm run mcp:http
```

Then in another shell:

```bash
curl -s http://localhost:8080/health
curl -s -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer $WARPAINT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Deploy to Fly.io

The repo ships a `Dockerfile` and `fly.toml`. Full recipe in
[docs/deploy-fly.md](docs/deploy-fly.md). Short version:

```bash
fly launch --no-deploy --copy-config --name <your-app-name>
fly volumes create warpaint_data --region fra --size 1
fly secrets set WARPAINT_TOKEN="$(openssl rand -hex 32)"
fly deploy
```

### Connect Claude

In Claude (mobile or web), add a custom connector:

- URL: `https://<your-app-name>.fly.dev/mcp`
- Header: `Authorization: Bearer <your token>`

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `WARPAINT_TOKEN` | yes | Bearer token; the server refuses to start without it |
| `PORT` | no (default `8080`) | TCP port to listen on |
| `HOST` | no (default `0.0.0.0`) | Bind address |
| `WARPAINT_INVENTORY_PATH` | no | Path to `inventory.json`; defaults to `~/.warpaint/inventory.json` |

### Known limitations

- Single user, one shared token. Anyone with the token has full read/write.
- Stateless transport: no long-running SSE tool streams (warpaint tools are
  fast so this is fine).

## Self-hosting your own MCP

The MCP server is generic — only the CLI (`warpaint`) is branded. To run your
own instance:

1. Fork or clone the repo.
2. (Optional) rename your Fly app in `fly.toml`.
3. Create a Fly volume and set secrets:

   ```bash
   fly volumes create inventory_data --size 1 --region <your-region>
   fly secrets set INVENTORY_SYNC_TOKEN=$(openssl rand -hex 24)
   # Optional one-time seed:
   fly secrets set INVENTORY_JSON="$(cat ~/.warpaint/inventory.json)"
   ```

4. (Optional) name your MCP server (shown in the MCP handshake and startup
   logs):

   ```bash
   fly secrets set MCP_SERVER_NAME=my-paints
   ```

5. Deploy:

   ```bash
   fly deploy
   ```

6. Register the remote in your local CLI and sync:

   ```bash
   warpaint sync add default \
     --url https://my-app.fly.dev \
     --token <token-from-step-3>
   warpaint sync push
   ```

After this, your local inventory and the deployed MCP stay in sync via
`warpaint sync push` (upload local → remote) and `warpaint sync pull --force`
(overwrite local from remote).
