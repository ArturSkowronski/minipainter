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
