# minipainter CLI — command reference

Verified against the CLI behavior. Every read supports `--json`; parse that.
All examples use `mpaint`; substitute `npx minipainter` or `node src/cli.mjs` as needed.

## Global behavior

- No `--help`/usage screen. Unknown command → stderr `Unknown command`, exit `1`.
- `--json` may appear anywhere in the args; it is stripped before command parsing.
- A thrown/internal error → exit `1` with the message on stderr.
- Resolution failures for a *known* command (not found / ambiguous) still exit `0` —
  detect them from the `message` field, not the exit code.

## Environment variables

| Var | Effect |
| --- | --- |
| `INVENTORY_PATH` | Absolute path to the inventory JSON. Overrides the default `~/.minipainting/inventory.json`. Use for a temporary or project-scoped inventory. |
| `INVENTORY_JSON` | Inline inventory JSON used to seed a fresh install when no file exists yet. |
| `DATABASE_URL` | If set, inventory is read/written in Postgres instead of the JSON file (server/Docker deploys). |

Legacy aliases still accepted: `WARPAINT_INVENTORY_JSON` (= `INVENTORY_JSON`).
A legacy `~/.warpaint/` data dir is auto-migrated to `~/.minipainting/` on first run.

## paint search

```
mpaint paint search "<query>" --json
```
Matches by name, alias, and normalized name. Shape:
```json
{ "message": "Found 45 paint matches", "items": [ { "id": "...", "name": "...",
  "provider": "...", "owned": true, "aliases": ["..."], "usage_roles": ["..."],
  "product_format": "opaque_base", "color_families": ["..."], "rgb": {"r":..,"g":..,"b":..} } ] }
```
`items` is empty (message still "Found 0 paint matches") when nothing matches.

## paint show

```
mpaint paint show "<name>" --json
```
- Found: `{ "message": "Showing <name>", "item": { ...paint... } }`
- Not resolvable: `{ "message": "Paint could not be resolved", "item": null, "items": [] }`
  (`items` carries candidates when the name was ambiguous).

## match color

```
mpaint match color "#RRGGBB" --json
```
Nearest paint per brand by straight RGB distance; owned paints float to the top.
`{ "message": "Color matches", "items": [ { ...paint..., "product_format": "..." } ] }`

## match describe

```
mpaint match describe "<free text>" --json
```
`{ "message": "Described paint matches", "items": [ { ...paint... } ] }`

## inventory list

```
mpaint inventory list --json
```
`{ "message": "Owned paints", "items": [ { ...owned paint... } ] }`

## inventory own / unowned  (WRITE)

```
mpaint inventory own "<name>"
mpaint inventory unowned "<name>"
```
Writes to `~/.minipainting/inventory.json` (or `INVENTORY_PATH`). Parent dir is
created automatically; the first write creates the file.

- Success: `{ "message": "<name> ownership updated", "item": { ...paint, "owned": true|false } }`
- Ambiguous: `{ "message": "Paint name is ambiguous", "items": [ ...candidates... ] }` — ask the user.
- Not found: `{ "message": "Paint not found", "items": [] }`.

## catalog (maintenance)

```
mpaint catalog sync    # seed/initialize the local inventory file
mpaint catalog lint    # fail if any paint has an unresolved product_format
```
`catalog lint` is a data-integrity check for maintainers; it exits non-zero when the
overlay in `data/overrides/product_formats.json` leaves any paint with a null
`product_format`.

## tui

```
mpaint tui
```
Interactive terminal UI. Requires a TTY; do not launch it from a non-interactive
agent context — use the subcommands above instead.
