# Warpaint MCP Server Design

Date: 2026-03-30
Status: Approved in chat, pending implementation

## Goal

Add a local MCP server to `warpaint-cli` so Claude Desktop can call deterministic paint search and inventory update tools against the existing local registry.

## Scope

This design covers:

- a stdio-based MCP server
- search tools
- inventory update tools
- README instructions for local Claude Desktop integration

This design does not cover:

- paint import from links or photos
- image-based recommendation workflows
- packaging as `.mcpb` in v1

## Chosen Direction

Use a thin MCP wrapper over the existing core modules:

- `registry-store`
- `search-engine`
- `inventory-service`

Do not shell out to the CLI. The MCP server should call shared application helpers directly.

## Tools

The v1 tool surface is:

- `paint_search`
- `paint_show`
- `inventory_list`
- `inventory_mark_owned`
- `inventory_mark_unowned`
- `match_color`
- `match_describe`

All tools must return structured deterministic payloads and preserve `ambiguous` / `not_found` outcomes explicitly.

## Architecture

Add:

- `src/paint-service.mjs` for shared application-level helpers
- `src/mcp-tools.mjs` for tool registration and result shaping
- `src/mcp-server.mjs` for MCP stdio startup

Keep CLI and MCP as separate adapters over the same core logic.

## Integration

The server should run locally through `node src/mcp-server.mjs`.

README should document a Claude Desktop config block that points to:

- command: `node`
- args: `["/absolute/path/to/src/mcp-server.mjs"]`

## Verification

Implementation should verify:

- all tools register and respond
- inventory mutations persist to the local registry file
- search and match payloads are structured and stable
- README setup instructions reflect the implemented command
