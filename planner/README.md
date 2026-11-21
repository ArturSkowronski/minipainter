# warpaint-model

A local browser app for planning how to paint a 3D-printed figure. Point it at a model's directory and it
shows every part, alone and assembled, in the browser. Layer-by-layer painting steps, colour zones and an
agent that works alongside you are designed but not built yet (see "Status").

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
"Relief" view shows what the app reads as recesses (blue) and raised areas (orange); the layer preview of the
next milestone is built on it.

## Where things are kept

`data/projects/<name>-<hash>/` (git-ignored) holds everything the app derives from a model: `plan.json`, two
meshes per part (`meshes/<variant>/<part>.glb` at about 150 000 triangles for single-part view and
`<part>.lod.glb` at about 30 000 for the assembled figure), the analysis of each mesh beside it
(`.patches.u32`, `.patches.json`, `.masks.u8`, `.lodmap.u32`), the zone of every face
(`zones/<variant>/<part>.u8`, one byte per triangle of the preview mesh) and reference images scaled to
1600 px. Zone names and colours are in `plan.json`.

The model's own directory is never written to. A mesh, once made, is never regenerated: to rebuild a part,
delete its two files and open the project again (from the command line, the start page, or by picking the
variant). Opening a project or picking a variant also retries parts that failed, for example because the
drive holding the model was offline. Set `WPM_DATA_DIR` to keep the workspace somewhere else.

## Keep it running (optional)

```sh
cp launchd/com.local.warpaint-model.plist ~/Library/LaunchAgents/
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

Measured on the two reference models (Chromium, 1440×900): Spiderman assembled 390 000 triangles and Ciri
assembled 770 000 triangles, both at 16.7 ms per frame; a single part at 150 000 triangles, 16.8 ms.

## Status

Design: `docs/superpowers/specs/2026-11-21-figure-painting-planner-design.md`.

| Milestone | State |
|---|---|
| 1. Open and view | built |
| 2. Zones (colour areas on each part, patch tool, brush) | built |
| 3. Layers and time travel (recipes, stage preview, paints from minipainter) | not built |
| 4. Agent (MCP server, session in the browser, skills) | not built |
