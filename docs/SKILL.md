---
name: minipainter
description: >-
  Manage a miniature-paint inventory and do cross-brand paint matching with the
  minipainter CLI. Use when the user wants to search hobby paints (Citadel, Army
  Painter, Vallejo, AK Interactive), find the closest paint to a color (hex) or to
  a description, check or update which paints they own, or reason about paint types
  across brands (washes, contrast, metallics, layers, drybrush, technical).
allowed-tools: Bash
---

# minipainter

Drive the `minipainter` CLI for paint search, cross-brand color matching, and
inventory tracking. Always pass `--json` on reads and parse the JSON — never scrape
the human-formatted text, and never branch on the exit code for "found vs not"
(see Failure handling).

## Install

If `minipainter` is not installed:

```bash
# runs straight from npm, no install needed
npx minipainter paint search bone

# or install once for the short `mpaint` command everywhere
npm install -g minipainter
```

Verify with `mpaint paint search bone` (or the `npx` form above).

## Invoking the CLI

Use the first form that resolves; do not assume a repo checkout:

1. `mpaint <args>` — installed globally or on PATH.
2. `npx minipainter <args>` — installed from npm, no checkout.
3. `node src/cli.mjs <args>` — run from inside a repo checkout.

There is **no `--help`**; an unknown command prints `Unknown command` and exits 1.

## Commands (add `--json` to every read)

| Intent | Command |
| --- | --- |
| Search the catalog | `mpaint paint search "<query>" --json` |
| Inspect one paint | `mpaint paint show "<name>" --json` |
| Nearest paints to a color | `mpaint match color "#RRGGBB" --json` |
| Nearest paints to words | `mpaint match describe "<description>" --json` |
| List owned paints | `mpaint inventory list --json` |
| Mark owned (write) | `mpaint inventory own "<name>"` |
| Mark unowned (write) | `mpaint inventory unowned "<name>"` |

Reads (`search`, `show`, `match`, `list`) are side-effect-free — run them freely.
Full flags, JSON shapes, and env vars are in `references/commands.md`.

## Rules

- **Writes mutate the user's inventory** at `~/.minipainting/inventory.json`
  (`own` / `unowned`). Confirm the exact paint first. To operate on a throwaway
  or project-scoped inventory instead, set `INVENTORY_PATH=/path/to/inventory.json`.
- **Cross-brand "is this the same kind of paint?" → read `product_format`**, never
  infer type from the name, RGB, or `usage_roles`. Values: `opaque_base`,
  `opaque_layer`, `wash`, `contrast`, `technical`, `drybrush`, `metallic`.
- **Owned paints sort first** in match/search results — when recommending, prefer
  what the user already owns before suggesting a new pot.
- `color_families` is a rough color bucket for browsing only; do not use it to
  reason about paint type.

## Failure handling (read `message`, not the exit code)

`own`, `unowned`, and `show` return **exit 0 even when they fail to resolve a paint**.
Branch on the JSON `message`:

- `"... ownership updated"` / `"Showing ..."` → success (payload in `item`).
- `"Paint name is ambiguous"` → several matches in `items`; show them and ask the
  user which one — do **not** pick one yourself.
- `"Paint not found"` / `"Paint could not be resolved"` → `items` is empty; report
  it and offer a `paint search` to find the right name.

## Prefer MCP when available

If the `minipainter` MCP tools (`paint_search`, `paint_show`, `match_color`,
`match_describe`, `inventory_list`, `inventory_mark_owned`, `inventory_mark_unowned`)
are connected, use them instead of shelling out — same operations, structured I/O.
Fall back to this CLI when MCP is not wired up.
