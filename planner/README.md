# minipainter planner

Lives in `planner/` of the [minipainter](../README.md) repository and is released on its own (see
"Release"). Every command below runs from this directory.

A local browser app for planning how to paint a 3D-printed figure. Point it at a model's directory and it
shows every part, alone and assembled, in the browser; you divide the parts into colour zones, give the zones
paint recipes, and step through the painting stages on the model, each step named with a paint you own. An
agent that works alongside you is designed but not built yet (see "Status").

## Run

```sh
uv run server.py "<model directory>"     # processes the model and opens the browser
uv run server.py                         # opens the list of recent projects
```

The server listens on `127.0.0.1:8770` only. If one is already running, the command hands the directory to
it instead of starting a second one. Options: `--port <n>`, `--no-browser`.

The first open of a model processes its parts in the background, smallest first; the page lists them as they
finish. The Spiderman split (13 parts, 700 MB of STL) takes under a minute. Later opens load from the
workspace at once.

## What counts as a model directory

Nom Nom Figures packages, in the three layouts seen so far:

| Layout | Example |
|---|---|
| `STL/<variant>/*.stl` and `Render Images/*.jpg` | Spiderman – Brand New Day |
| `<variant>/*.stl` and images in the root | Ciri |
| `<Name>_STL/<variant>/*.stl`, no images | Artorias |

A plain folder of STL files is treated as a model with one variant. You can point at the package, at its
`STL` folder or at one variant; the whole package opens either way, with that variant selected.

Ignored: anything under a folder whose name contains `presupport`, `*_Supported.stl`, `output*.stl`
(redistributor banners), and non-STL files. Archives are not unpacked: unzip first. Only binary STL is read.

Images are sorted by file name into colour references (`Colored_*`), turntables, beauty shots, parts sheets,
bust and scale pictures.

## Zones

A part is one mesh, but it is rarely one colour. In "Komponent" view you divide the selected part into
zones — named areas that will each get one paint recipe:

1. "＋ Strefa" adds a zone; click its name or colour to change them. The highlighted zone is the one you paint.
2. "Płat" assigns a whole patch with one click. Patches are cut along the sculpt's creases, so a web cell, a
   strap or a panel is usually one patch ("Płaty" view shows them; "Płaty…" changes how finely they are cut).
3. "Pędzel" and "Gumka" paint and clear freehand; the size is in millimetres of the model.
   "Trzymaj się płata" keeps a stroke inside the patch it started on, "Tylko puste miejsca" keeps tools from
   changing what already has a zone.
4. "Wypełnij resztę" gives everything still unassigned to the active zone.

On Spiderman's torso that is three clicks for the blue panels and the whole web, and one button for the red.
Strokes are saved as you go and can be undone (⌘Z). The assembled figure shows every part in its zone colours.
"Relief" view shows what the app reads as recesses (blue) and raised areas (orange); the painted view below is
built on it.

## Layers and time travel

"Malowanie" (next to "Strefy" in the toolbar) shows the model painted, with a timeline under it and the recipe
panel on the right.

A **recipe** says how one kind of surface is painted: a base colour, a highlight colour, how many layers lie
between them (0–6), and which of shade, lining, highlight and ink it uses. Recipes belong to the figure, not to
a part: "suit red" is written once and used by the body, the arms and the legs. Give a zone a recipe from the
list under its name in the zone list; "＋ Nowa z tej strefy" makes one from the zone's name and colour.

Each recipe resolves to **steps** — base, layer 1…n, shade, lining, highlight, ink — and every step names a
paint you own, or a mix of the base and highlight paints in simple parts (2 : 1, 1 : 1, …). An owned bottle is
used for a layer when it is close enough to the layer's colour; "Dobór farb" prefers bottles or mixes. "zmień"
on a step pins any paint you own to it, "Automatycznie" unpins. A step warns when the nearest owned paint is
far from the colour asked for, and says so when you own nothing of the kind it needs.

The **timeline** has one stop per stage of what is on screen (as many layer stops as the recipe with the most
layers); drag it, click a stop, or use ← and →. The model shows where each stage puts paint: layers climb
towards raised and upward-facing surfaces, shade gathers in recesses, lining follows the deepest grooves,
highlight sits on edges. It is an indication of where and roughly what colour, not a render. The same
timeline drives "Złożona figurka".

The model shows a stage in one of two ways (toolbar, next to "Malowanie"). **"Ten etap"** shows the paint of
that stage at full strength exactly where it goes and drains the colour from everything else, so a stage reads
at a glance even when its paint is close to the previous one; a zone with nothing to do at that stage is grey
as a whole. **"Wynik"** shows the figure as it looks after the stage.

The panel writes the painting of the selected part out per colour: under "Teraz" what each colour gets at the
stage the timeline stands on (or that it has nothing to do there), and under "Plan malowania" one block per
recipe used on the part, with the areas it covers and all its steps in order. The step that is the current
stage is opened with where and how to apply it and a note of your own. Clicking a step moves the timeline to
it and brings its recipe into the settings above.

Tick a step when it is done on the selected part; the part list shows done/all. Clicking the model picks the
zone under the pointer. "Podkład" sets the primer colour of the whole figure.

Paints come from [minipainter](https://www.npmjs.com/package/minipainter): the server runs
this repository's CLI (`node ../src/cli.mjs paint search --json`) once when it starts and again on "odśwież".
That lists the whole catalogue with the owned paints marked. Unpacked from a release archive, without the
rest of the repository, it runs `mpaint paint search --json` instead, so install minipainter first
(`npm i -g minipainter`). Set `WPM_MPAINT` to use another command line; a command that lists only the owned paints (`mpaint inventory list --json`)
works too, but then there is nothing to propose for purchase. The inventory is only read.
What kind of product a paint is comes from minipainter's `product_format`: base and layer steps use
`opaque_base` and `opaque_layer` paints (`metallic` for a recipe marked "Metaliczna"), shade and lining use
`wash`, ink uses `ink` and `contrast`. Without minipainter the steps still show their colours, without paints.

### What to buy

"Czego brakuje?" in the painting panel lists the steps the owned paints do not cover and proposes paints
of the catalogue for them. It looks at the recipes the zones use (at all of them while no zone uses one).

- **Brakuje**: the step has no paint, the nearest owned paint is another colour (more than twice the bottle
  distance away, 0.08 by default), or the highlight is the base paint again, so the layers have nothing to
  blend towards.
- **Warto dokupić**: the owned paint is only roughly the colour (between one and two bottle distances), or
  the recipe prefers bottles and a layer is mixed.

Each gap gets the nearest paint of up to three brands, and only paints clearly nearer than what is owned.
The first is tried before it is listed: it is added to the owned paints and the recipe resolved again, so
the list says which steps the bottle then serves, and one bottle is not proposed twice. A pinned step is
never a gap. Washes are judged loosely (their bottle colour says little), and a lining wash only when no
wash is owned. "Kopiuj listę" puts the list on the clipboard as text. Nothing is written anywhere: the
inventory stays minipainter's.

## Where things are kept

`data/projects/<name>-<hash>/` (git-ignored) holds everything the app derives from a model: `plan.json`, two
meshes per part (`meshes/<variant>/<part>.glb` at about 150 000 triangles for single-part view and
`<part>.lod.glb` at about 30 000 for the assembled figure), the analysis of each mesh beside it
(`.patches.u32`, `.patches.json`, `.masks.u8`, `.lodmap.u32`, `.lodmasks.u8`), the zone of every face
(`zones/<variant>/<part>.u8`, one byte per triangle of the preview mesh) and reference images scaled to
1600 px. Zone names and colours, recipes, the primer colour and the done marks are in `plan.json`. When a new
version of the app analyses meshes differently, parts are analysed again on the next open; meshes and zones
are not touched by that.

The model's own directory is never written to. A mesh, once made, is never regenerated: to rebuild a part,
delete its two files and open the project again (from the command line, the start page, or by picking the
variant). Opening a project or picking a variant also retries parts that failed, for example because the
drive holding the model was offline. Set `WPM_DATA_DIR` to keep the workspace somewhere else.

## Keep it running (optional)

```sh
sed -e "s|/Users/YOU/minipainter/planner|$PWD|" -e "s|/Users/YOU|$HOME|" \
  launchd/com.local.warpaint-model.plist > ~/Library/LaunchAgents/com.local.warpaint-model.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.local.warpaint-model.plist
```

Logs go to `~/Library/Logs/warpaint-model.log`. To stop: `launchctl bootout gui/$(id -u)/com.local.warpaint-model`.

## Develop

```sh
uv run pytest            # server, pipeline, profile, workspace
node --test ui/tests/    # pure page logic
scripts/vendor-three.sh  # re-create ui/vendor/ from the pinned Three.js release
```

The page is plain ES modules with Three.js vendored in `ui/vendor/`; there is no build step. In the browser
console, `__viewerBenchmark()` orbits the model for 120 frames and reports triangles drawn and mean frame time.

Moving the timeline repaints a 150 000-triangle part in about 15 ms and the assembled Spiderman in about
30 ms; a change of a recipe's layer count is on screen about 25 ms after the slider moves.

Measured on the two reference models (Chromium, 1440×900): Spiderman assembled 390 000 triangles and Ciri
assembled 770 000 triangles, both at 16.7 ms per frame; a single part at 150 000 triangles, 16.8 ms.

## Release

The planner has its own version (`version` in `pyproject.toml`) and its own tags: `planner-vX.Y.Z`. Pushing
such a tag runs `.github/workflows/planner-release.yml`: the tests, then a GitHub release with this directory
as `minipainter-planner-X.Y.Z.tar.gz`. The tag has to equal the version in `pyproject.toml`. minipainter's
own releases are the `vX.Y.Z` tags; the two never trigger each other, and the planner is not part of the npm
package.

## Status

| Milestone | State |
|---|---|
| 1. Open and view | built |
| 2. Zones (colour areas on each part, patch tool, brush) | built |
| 3. Layers and time travel (recipes, stage preview, paints from minipainter) | built |
| 4. Agent (MCP server, session in the browser, skills) | not built |
