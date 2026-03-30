# Warpaint Inventory CLI Design

Date: 2026-03-30
Status: Approved and implemented on `feature/warpaint-inventory`

## Goal

Build a local-first `warpaint` CLI with a TUI for managing a paint inventory for Warhammer painting. The system must help a novice painter track owned paints from Citadel and Army Painter using a single local registry file. The future recommendation skill will rely on this registry to prefer owned paints first while still suggesting better external alternatives when useful.

This spec covers only the inventory/search application. It does not cover implementation of the separate AI skill beyond the interface boundary the skill will use.

## Product Scope

The inventory application must:

- ship with built-in Citadel and Army Painter catalogs
- store owned paint state in a single local file
- support both human browsing and agent-facing deterministic search
- categorize paints by both usage role and color family
- attach approximate RGB color data to each paint
- provide a TUI for browsing, filtering, and toggling ownership
- expose stable CLI commands that the future skill can call

The inventory application must not:

- perform OCR or image understanding itself
- parse product links itself
- invent new paint records at runtime
- require users to know internal paint IDs

## Users

Primary user:
- a novice Warhammer painter who wants help choosing paints from an existing collection

Secondary user:
- a separate AI skill that needs deterministic search and matching over the same paint registry

## Core Principles

- Owned-first: owned paints rank ahead of non-owned paints in search and color matching
- Human-first input: users interact by paint names, not internal IDs
- Deterministic core: catalog, search, match, and inventory updates must behave predictably without AI
- Single source of truth: one local JSON registry file stores catalog metadata and owned state
- Agent-ready: the CLI must provide structured output so the future skill can call it safely

## Architecture

The application consists of four units with clear boundaries:

1. Registry store
   - loads and saves the single JSON registry file
   - validates schema and normalizes persisted data

2. Search and matching engine
   - resolves paint names and aliases
   - filters by provider, ownership, usage role, and color family
   - ranks results with owned-first behavior
   - matches approximate colors using stored RGB values

3. CLI interface
   - exposes stable commands for search, inspection, matching, and ownership updates
   - supports both human-readable and JSON output

4. TUI interface
   - provides interactive browsing over the same search and registry operations
   - never bypasses the registry or search engine

The future AI skill is an external consumer. It can read and update inventory only through the CLI contract or the documented file schema, but it is not part of this application's runtime responsibilities.

## Data Model

The source of truth is a single JSON registry file. A representative structure:

```json
{
  "version": 1,
  "catalog": {
    "providers": [
      {
        "id": "citadel",
        "name": "Citadel"
      },
      {
        "id": "army_painter",
        "name": "Army Painter"
      }
    ],
    "paints": [
      {
        "id": "citadel/abaddon-black",
        "provider": "citadel",
        "name": "Abaddon Black",
        "normalized_name": "abaddon black",
        "aliases": [],
        "usage_roles": ["base"],
        "color_families": ["black"],
        "rgb": { "r": 20, "g": 20, "b": 20 },
        "owned": false
      }
    ]
  }
}
```

Each paint record must include:

- stable internal ID in the form `<provider>/<slug>`
- provider ID
- display name
- normalized name for matching
- zero or more aliases
- one or more usage roles
- one or more color families
- approximate RGB value
- owned flag

Optional future-safe fields may include:

- finish hints such as `matte` or `satin`
- family equivalence hints for cross-provider matching
- provenance fields indicating where catalog data came from

V1 stores only simple ownership state. It does not track quantity, notes, or bottle condition.

## Categorization

Two categorization systems are required because both human use and the future agent need them:

- usage role
  - examples: `base`, `layer`, `shade`, `contrast`, `speedpaint`, `metallic`, `technical`, `dry`
- color family
  - examples: `red`, `blue`, `green`, `bone`, `skin`, `leather`, `steel`, `gold`, `black`, `white`

Both categories are filterable and searchable. They are not substitutes for RGB; they provide semantic grouping while RGB enables approximate color comparison.

## Name Resolution

Humans must not need to know paint IDs. All user-facing commands should accept:

- paint name
- provider plus paint name
- internal ID for machine use

Name resolution behavior:

- exact name match resolves immediately
- alias matches resolve immediately
- close matches produce a short disambiguation list
- ambiguous names across providers prompt the user to choose or require provider disambiguation

Once resolved, all internal operations use the stable paint ID.

## Search and Matching

The search engine is the core of the product because the future skill depends on it more than the TUI does.

It must support:

- exact and fuzzy name search
- alias search
- provider filtering
- ownership filtering
- usage-role filtering
- color-family filtering
- owned-first ranking
- RGB proximity matching from hex or RGB input

Search ranking rules:

1. exact name and alias matches rank first
2. owned paints rank ahead of non-owned paints for equivalent relevance
3. provider and filter matches outrank partial fuzzy matches
4. RGB distance influences ranking for color-match commands

The system should support queries such as:

- owned bone paints
- metallic silver paints from any provider
- closest owned paint to `#d7c59a`
- dark green armor paints, owned first

## CLI Command Surface

The CLI exposes deterministic commands and JSON output for both human and agent use.

Core commands:

- `warpaint catalog sync`
  - initializes or refreshes the built-in registry file for supported providers
- `warpaint paint search <query>`
  - searches by name or alias
  - supports filters for provider, owned, usage role, and color family
- `warpaint paint show <paint>`
  - shows a resolved paint entry using name, provider-plus-name, or internal ID
- `warpaint inventory own <paint>`
  - marks a resolved paint as owned
- `warpaint inventory unown <paint>`
  - marks a resolved paint as not owned
- `warpaint inventory list`
  - lists owned paints with optional filters
- `warpaint match color <rgb-or-hex>`
  - returns nearest matches ranked owned first
- `warpaint match describe <terms>`
  - resolves semantic paint requests using names, aliases, usage roles, and color-family tags

Output modes:

- default human-readable terminal output
- `--json` structured output for skill integration

JSON results should clearly include:

- `id`
- `name`
- `provider`
- `owned`
- `usage_roles`
- `color_families`
- `rgb`
- ranking metadata when relevant

## TUI Design

The TUI is a thin interactive layer over registry and search functionality. It should not own business logic.

Primary views:

1. Catalog view
   - searchable list of all paints
   - filters for provider, ownership, usage role, and color family
   - quick toggle for owned state

2. Owned view
   - list of owned paints only
   - filter and group by provider, usage role, or color family

3. Paint detail view
   - complete metadata for one paint
   - shows RGB, categories, aliases, provider, and owned state

The TUI should optimize the fast path:

- search for a paint
- select it
- toggle owned
- continue searching

The TUI should remain shallow and avoid deeply nested workflows.

## Skill Boundary

The future recommendation and ingestion skill is intentionally separate.

Responsibilities of the skill:

- interpret product links
- interpret photos of paint sets or racks
- interpret model photos and painting intent
- resolve extracted names against the CLI
- update inventory after confirmation or high-confidence match
- recommend owned paints first and better alternatives second

Responsibilities of the inventory app:

- define and persist the registry schema
- provide deterministic lookup and matching
- update ownership state
- return structured search results

This separation keeps AI uncertainty out of the core data layer.

## Import and Update Flow

The inventory app does not ingest links or photos directly. Instead:

1. the skill extracts candidate paint names from a link or image
2. the skill resolves candidates through `warpaint paint search`
3. the skill marks confirmed matches with `warpaint inventory own`
4. unresolved or ambiguous matches are surfaced for review

Recommended import modes for the skill:

- review mode
  - proposes candidate matches before writing inventory changes
- apply mode
  - writes high-confidence matches directly

The inventory CLI only guarantees deterministic resolution and updates.

## Error Handling

The application must handle the following cases explicitly:

- missing registry file
  - offer to initialize it with `catalog sync`
- corrupted registry file
  - fail with a clear validation error and file path
- unknown provider
  - reject with a supported-provider message
- unresolved paint name
  - return close matches and suggest search
- ambiguous name
  - return disambiguation options
- missing RGB data in a paint entry
  - exclude from color-distance ranking and show that data is incomplete

The TUI should surface these states clearly without dropping the user into raw stack traces.

## Testing Strategy

Testing must focus on deterministic behavior at the boundaries that matter to both humans and the future skill.

Required automated coverage:

- registry schema validation
- load and save round-trips
- name normalization and alias resolution
- ambiguous-name handling
- filtering by provider, owned, usage role, and color family
- owned-first ranking
- RGB proximity matching
- CLI JSON output stability

Recommended integration coverage:

- initialize catalog, mark paints owned, and list them
- search by name and by alias
- resolve ambiguous cross-provider paint names
- run color match queries with owned and non-owned results

TUI testing can stay lighter in v1 and focus on essential navigation and ownership toggling, because the critical correctness lives in the registry and search engine.

## Open Constraints for Implementation Planning

The design intentionally leaves these choices for the implementation plan:

- language and framework for the CLI and TUI
- exact TUI library
- exact fuzzy-matching algorithm
- exact JSON schema layout details beyond the required fields and behaviors
- catalog data acquisition process for Citadel and Army Painter

Those are implementation decisions, not product-design blockers, as long as the resulting system preserves the boundaries and behaviors in this spec.

## Implementation Notes

The first implementation on `feature/warpaint-inventory` uses local JSON starter catalogs under `data/catalog/` rather than a complete upstream provider sync. The search, inventory, CLI, and TUI boundaries in this spec were implemented as designed, and the catalog-loading layer remains isolated so fuller provider catalogs can replace the starter assets later without restructuring the rest of the application.
