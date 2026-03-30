# Warpaint Forge Ledger TUI And README Design

Date: 2026-03-30
Status: Approved in chat, pending spec review and user review

## Goal

Redesign the `warpaint-cli` terminal experience and README so the project feels like a distinctive grimdark hobby tool instead of a plain technical prototype. The result should emphasize strong ASCII presentation, visually rich TUI screenshots, and a README that sells the product through visuals and narrative as much as through raw command documentation.

## Scope

This design covers:

- a new `Forge Ledger` visual direction for the TUI
- ASCII art and frame styling for terminal screens
- screenshot generation for README assets
- a major README rewrite around presentation and usability

This design does not cover:

- changes to the underlying paint registry model
- changes to search ranking or CLI semantics beyond presentation support
- implementation of the separate AI skill

## User Intent

The user wants:

- a much more attractive TUI
- clear grimdark Warhammer-adjacent atmosphere
- strong ASCII art and terminal framing
- screenshots embedded in README
- a README that feels polished, persuasive, and visually rich

The user explicitly chose:

- visual tone: `grimdark`
- priority: `maksymalny klimat`
- direction: `Forge Ledger`

## Design Direction

The TUI should look like a grimdark inventory ledger used at a painting bench. It should feel heavy, crafted, and atmospheric, with the terminal framed like a forged archive rather than a plain list viewer.

The core design principle is:

- mood first in presentation
- usability preserved in data layout

That means the interface should be dramatically styled, but paint names, owned state, roles, families, and RGB values must remain easy to scan.

## TUI Layout

The TUI should adopt a full framed screen layout with four major regions:

1. Hero banner
   - large ASCII `WARPAINT` banner at the top
   - optional subtitle such as `FORGE LEDGER` or `Inventory For The Painting Bench`

2. Status strip
   - current view
   - total visible matches
   - total owned paints
   - active search query

3. Main two-column body
   - left: paint list panel
   - right: selected paint detail panel

4. Command strip
   - bottom legend for available commands
   - presented as terse ritual-like commands without becoming roleplay-heavy

The screen should use heavy box-drawing characters and section labels to create a visually strong frame.

## TUI Naming And Copy

Section names should be thematic but still clear:

- `FORGE CATALOG`
- `OWNED VIALS`
- `SELECTED PIGMENT`
- `RITUAL COMMANDS`

State labels should be stronger than plain yes/no:

- `OWNED`
- `MISSING`
- `BOUND TO INVENTORY`

Copy should remain short and practical. Avoid overdoing lore language. The tone should suggest atmosphere without making the interface harder to use.

## ASCII Art Direction

ASCII should be:

- bold
- symmetrical
- forged / ledger-like
- terminal-native

ASCII should not be:

- jokey
- meme-like
- noisy to the point of reducing readability

Required ASCII elements:

- one large top-level project banner
- section headers framed with box drawing
- at least one decorative separator style reused consistently

The design should rely primarily on monochrome terminal output. It may optionally support ANSI color accents later, but the base design must still look good without color.

## Screenshot Plan

README should include four screenshots:

1. Hero screenshot
   - full TUI frame
   - banner visible
   - catalog and detail panel both populated

2. Search screenshot
   - query such as `bone`
   - filtered results visible
   - detail panel showing relevant paint

3. Owned screenshot
   - inventory-focused view with owned paints only
   - demonstrates collection management angle

4. CLI screenshot
   - command-line examples with high-signal output
   - should visually complement the TUI screenshots

Screenshots should be generated from the actual tool output, not mocked by hand, as much as practical. If terminal screenshots need a helper script to make them reproducible, that script is in scope.

## README Direction

README should become a showcase document, not only an instruction sheet.

New structure:

1. Hero section
   - project name
   - strong tagline
   - short product pitch
   - primary screenshot

2. Why this exists
   - explain the real hobby problem:
     AI paint advice often ignores what you actually own

3. Feature highlights
   - owned-first matching
   - local paint registry
   - RGB-aware lookup
   - grimdark TUI
   - agent-friendly CLI

4. Screenshots section
   - each image with a short explanation

5. Quickstart
   - initialize registry
   - search paints
   - mark ownership
   - run matching
   - launch TUI

6. TUI workflow
   - explain views
   - explain bottom command strip
   - explain how the selected paint panel should be read

7. Project direction
   - implemented now
   - future skill for links and photos

8. Technical notes
   - local JSON registry
   - local starter catalogs
   - approximate RGB caveat

## Asset Strategy

The implementation may add:

- a screenshot generation script
- an `assets/` or `docs/assets/` directory for README images
- curated sample registry data or scripted demo commands for consistent screenshots

Any such assets should be lightweight and reproducible. Avoid introducing heavy GUI dependencies if terminal capture can be automated simply.

## Architecture Boundaries

The redesign should preserve existing code boundaries where possible:

- TUI state and rendering remain mostly testable and separate from terminal I/O
- CLI commands remain deterministic
- README and asset generation stay outside core business logic

If the current TUI rendering file becomes too crowded, it is appropriate to split:

- ASCII/banner generation
- frame rendering
- TUI state model
- screenshot/demo helpers

## Error Handling And Practicality

Even with maximum atmosphere, the TUI must still:

- render cleanly in standard terminals
- degrade reasonably on narrower terminal widths
- avoid broken layouts when a paint name is longer
- avoid unreadable wrapping in README screenshots

If needed, the first pass may target a recommended terminal width and document that expectation in README.

## Testing And Verification

Implementation should verify:

- TUI rendering tests still pass after redesign
- README references valid screenshot asset paths
- screenshot generation process is reproducible
- example commands in README work against the implemented CLI

At least one verification step should ensure the generated screenshots match current tool output rather than stale hand-edited text.
