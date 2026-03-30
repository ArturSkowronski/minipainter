# warpaint-cli

Local-first paint inventory tooling for Warhammer painting workflows.

## What It Does

- keeps a single local registry file at `.warpaint/registry.json`
- ships with local starter catalogs for `Citadel` and `Army Painter`
- lets you search paints by name, alias, role, family, and color
- tracks simple owned/not-owned state
- exposes deterministic CLI commands for future agent integration
- includes a thin interactive TUI

## Commands

Initialize the local registry:

```bash
node src/cli.mjs catalog sync
```

Search paints:

```bash
node src/cli.mjs paint search black
node src/cli.mjs paint search bone --json
```

Inspect a paint:

```bash
node src/cli.mjs paint show "Abaddon Black" --json
```

Mark ownership:

```bash
node src/cli.mjs inventory own "Abaddon Black"
node src/cli.mjs inventory unown "Abaddon Black"
node src/cli.mjs inventory list --json
```

Color and semantic matching:

```bash
node src/cli.mjs match color "#151515" --json
node src/cli.mjs match describe bone --json
```

Run the TUI:

```bash
node src/cli.mjs tui
```

TUI commands:

- `search <text>`
- `owned`
- `catalog`
- `toggle`
- `quit`

## Notes

- Built-in catalogs are local JSON starter assets in `data/catalog/`.
- The inventory core is deterministic; link parsing, OCR, and image interpretation belong in the future separate skill.
- Paint RGB values are approximate and intended for ranking, not exact physical-color guarantees.
