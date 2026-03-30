# Warpaint MCP Server Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local MCP server that exposes deterministic search and inventory update tools for Claude Desktop.

**Architecture:** Build a thin MCP adapter around the existing registry, search, and inventory modules through a shared `paint-service` layer. Keep CLI behavior intact and expose a stdio MCP server plus README integration instructions.

**Tech Stack:** Node.js 25, ESM modules, existing domain modules, official MCP TypeScript/JavaScript SDK if needed, `node:test`

---

## Chunk 1: Shared Service Layer And Tests

### Task 1: Add shared paint service helpers

**Files:**
- Create: `src/paint-service.mjs`
- Create: `tests/paint-service.test.mjs`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/paint-service.test.mjs`
Expected: FAIL with missing module/functions
- [ ] **Step 3: Write minimal implementation**
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test tests/paint-service.test.mjs`
Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add src/paint-service.mjs tests/paint-service.test.mjs
git commit -m "feat: add shared paint service for cli and mcp"
```

## Chunk 2: MCP Adapter

### Task 2: Add MCP tools module and server startup

**Files:**
- Create: `src/mcp-tools.mjs`
- Create: `src/mcp-server.mjs`
- Modify: `package.json`
- Create: `tests/mcp-tools.test.mjs`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/mcp-tools.test.mjs`
Expected: FAIL with missing MCP tool adapter
- [ ] **Step 3: Write minimal implementation**
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test tests/mcp-tools.test.mjs`
Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add src/mcp-tools.mjs src/mcp-server.mjs package.json tests/mcp-tools.test.mjs
git commit -m "feat: add warpaint mcp server"
```

## Chunk 3: Docs And Verification

### Task 3: Document Claude Desktop setup and verify end-to-end

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-03-30-warpaint-mcp-server-design.md`

- [ ] **Step 1: Add a failing verification test**
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/mcp-tools.test.mjs`
Expected: FAIL because README lacks MCP setup section
- [ ] **Step 3: Write minimal implementation**
- [ ] **Step 4: Run full verification**
Run: `npm test`
Expected: all tests PASS
- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-03-30-warpaint-mcp-server-design.md tests/mcp-tools.test.mjs
git commit -m "docs: add claude desktop mcp setup"
```
