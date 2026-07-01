# ChatGPT-compatible MCP endpoint (v3) — design

**Date:** 2026-07-01
**Status:** approved, in implementation

## Goal

Expose a second MCP endpoint that satisfies the OpenAI ChatGPT connector contract
(`search` + `fetch` tools) so the paint catalog can be used as a ChatGPT connector
(including Deep Research). Version it as **v3**, test it on the real Fly.io deployment
(`warpaint-mcp.fly.dev`) before tagging **v0.3**.

The existing `POST /mcp` endpoint (7 paint tools, used by Claude) stays untouched.

## ChatGPT MCP contract

ChatGPT connectors require two tools with a fixed I/O shape. Each tool result is a
single text content block whose `text` is a JSON string.

- `search({ query })` → `{"results":[{"id","title","url"}]}`
- `fetch({ id })` → `{"id","title","text","url","metadata"}`

## Mapping onto the paint domain

- **search**: `searchPaintCatalog({ query })` → take top `SEARCH_LIMIT` (20) items.
  - `id` = paint id (`citadel/nuln-oil`)
  - `title` = `"<name> (<provider>)"`
  - `url` = `<PUBLIC_BASE_URL>/api/paints/<id>`
- **fetch**: `showPaint({ paint: id })`.
  - `text` = human-readable summary (name, provider, product_format, usage roles,
    color families, RGB hex, owned)
  - `metadata` = flat string map of the structured fields
  - `url` = `<PUBLIC_BASE_URL>/api/paints/<id>`
  - not-found/ambiguous → a well-formed fetch doc explaining the miss (never throws)
- **match_color**: existing `matchPaintByColor` schema (hex/rgb + filters), returned as a
  JSON text block. Extra beyond the strict contract; harmless for Deep Research, useful
  for developer-mode connectors.

## Components (isolated, testable)

- `src/chatgpt-mcp-tools.mjs`
  - `buildSearchResults(searchCatalogResult, { baseUrl, limit })` — **pure**
  - `buildFetchResult(showPaintResult, requestedId, { baseUrl })` — **pure**
  - `createChatGptMcpServer({ inventoryPath, baseUrl })` — registers `search`,
    `fetch`, `match_color`; wraps payloads as `{content:[{type:'text',text:JSON}]}`
- `src/transports/http/server.mjs`
  - refactor `handleMcpRequest` to take a `serverFactory`
  - new route `POST /mcp/v3` → StreamableHTTP with `createChatGptMcpServer`
  - `/mcp` unchanged
- `src/infrastructure/config/runtime-config.mjs`
  - add `publicBaseUrl = env.PUBLIC_BASE_URL || 'https://warpaint-mcp.fly.dev'`

## Data flow

`POST /mcp/v3` → StreamableHTTPServerTransport → ChatGPT MCP server →
`search`/`fetch`/`match_color` handler → paint-service query → pure builder → JSON text.

## Error handling

- Builders never throw; a missing/ambiguous id yields a valid fetch doc.
- Reuse existing 500 catch in `createHttpServer`.
- Auth: same optional bearer as `/mcp` (unauthenticated by default, URL obscurity).

## Testing

- Unit: `buildSearchResults` (cap, title/url shape, empty), `buildFetchResult`
  (resolved, not_found, ambiguous, metadata stringification).
- Dispatch: `/mcp/v3` recognized as a route.
- `npm test` green before deploy.

## Verification before tag (hard gate)

1. `npm test` green.
2. `fly deploy`.
3. Against real `https://warpaint-mcp.fly.dev`: `initialize`, `tools/list` shows
   `search`+`fetch`(+`match_color`), `tools/call search`, `tools/call fetch` return the
   contract JSON.
4. Only then `git tag v0.3`.

## Follow-up (explicitly deferred)

Unify versioning consistently afterwards: reorganize `/mcp` + `/mcp/v3` into a coherent
`/mcp/vN` scheme (and decide the canonical default). Tracked as a second step per user
request ("najpierw zrób nowy ale potem chciałbym to zrobić spójnie").
