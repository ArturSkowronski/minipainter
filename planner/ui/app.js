// Screens and wiring. Rendering is plain DOM; what to show comes from model.js, the 3D stage from viewer.js.
import * as api from "./api.js";
import { h } from "./dom.js";
import { fetchArray } from "./geometry.js";
import {
  KIND_LABEL, ROLE_LABEL, STATUS_LABEL, activeVariant, assembledParts, firstViewablePart, keyAction, paintable,
  progress, routeFromHash, sidecarPath,
} from "./model.js";
import { loadPaintMesh, lodFaceColors, lodStageColors } from "./paintmesh.js";
import { createRecipePanel } from "./recipepanel.js";
import { buildStage, progressOf, settle, stepsKey, timeline } from "./stagemodel.js";
import { createTimeline } from "./timeline.js";
import { createViewer } from "./viewer.js";
import { ZoneEdit, dropUnknownZones, hexToRgb, unassignedFaces, zoneShares } from "./zonesmodel.js";

const root = document.getElementById("app");
let teardown = () => {};

function route() {
  teardown();
  teardown = () => {};
  root.replaceChildren();
  const target = routeFromHash(location.hash);
  if (target.screen === "project") teardown = projectScreen(target.slug);
  else startScreen();
}


// ---------------------------------------------------------------------------------------------------
// Start: open a directory, or pick a recent project.

function startScreen() {
  document.title = "warpaint-model";
  const error = h("p", { class: "form-error", role: "alert" });
  const input = h("input", {
    id: "path", type: "text", placeholder: "Ścieżka do katalogu modelu", autocomplete: "off",
    spellcheck: false, "aria-label": "Ścieżka do katalogu modelu",
  });
  const button = h("button", { class: "btn", type: "submit" }, "Otwórz");
  const form = h("form", {
    class: "open-form",
    onsubmit: async event => {
      event.preventDefault();
      error.textContent = "";
      button.disabled = true;
      try {
        const { slug } = await api.openProject(input.value);
        location.hash = `#p/${slug}`;
      } catch (failure) {
        error.textContent = failure.message;
        button.disabled = false;
      }
    },
  }, input, button);
  const list = h("ul");
  const recent = h("section", { class: "recent", hidden: true }, h("h2", {}, "Ostatnie"), list);
  root.append(h("main", { class: "start" },
    h("h1", {}, "Otwórz paczkę"),
    h("div", {}, form, error),
    recent));
  input.focus();

  api.listProjects().then(projects => {
    recent.hidden = projects.length === 0;
    list.replaceChildren(...projects.map(project => h("li", {},
      h("a", { href: `#p/${project.slug}` }, project.name, h("span", { class: "path" }, project.source)))));
  }).catch(failure => { error.textContent = failure.message; });
}

// ---------------------------------------------------------------------------------------------------
// Project: variant, parts, zones and references on the left; the stage in the middle; when painting, the
// timeline under the stage and the recipe panel on the right.

const WORKS = [["zones", "Strefy"], ["paint", "Malowanie"]];
const NEUTRAL = "#8b8e93";      // what has no zone is shown in this grey while zones are being drawn
const TOOLS = [["orbit", "Obrót"], ["brush", "Pędzel"], ["patch", "Płat"], ["erase", "Gumka"]];
const VIEWS = [["zones", "Strefy"], ["patches", "Płaty"], ["relief", "Relief"]];
const SAVE_DELAY = 400;
const RETRY_DELAY = 3000;

function projectScreen(slug) {
  const state = {
    plan: null, selected: null, mode: "part",
    work: "zones",              // "zones": dividing parts into zones; "paint": recipes and the timeline
    tool: "orbit", radius: 2, stayInPatch: false, onlyEmpty: false, view: "zones",
    position: null,             // the timeline stop the user chose; null = the last one, the finished figure
    recipe: null,               // the recipe the panel shows
  };
  let fetching = false;
  let stale = false;
  let closed = false;
  let lightbox = null;
  const drawn = { variants: "", refs: "", zones: "" };

  // What is being painted: one part's mesh, its zone array and the bookkeeping of saving it.
  // rev is the server's zones_rev this page's array is based on; dirty/saving/timer track sending it back.
  let paint = null;             // { key, variant, part, mesh, edit, rev, dirty, saving, timer, following, ... }
  let shown = "";               // what the stage currently holds, so a plan refresh does not reload it
  let strokeOpen = false;
  let assembledTicket = 0;
  const figure = new Map();     // variant/part -> { rev, zones, lodmap, lodmasks }: what colours the assembled figure

  // What the recipes resolve to with the paints owned now. Fetched again when stepsKey(plan) changes.
  const steps = { key: null, rev: 0, loading: false, profile: { id: null, stages: ["primer"] }, recipes: {}, inventory: null };
  let paints = [];              // the owned paints, for choosing one by hand
  let positions = [];           // the timeline's stops for what is on screen
  let position = null;          // where the timeline stands among them
  let lookKey = "";             // what the painted part currently shows, so it is repainted only on a change
  const problem = { text: null, count: 0 };   // the last change the server did not take, shown in the panel
  const changeSeq = new Map();  // recipe id -> number of the latest change sent

  // -- skeleton -----------------------------------------------------------------------------------

  const title = h("h1", {}, "…");
  const variantSelect = h("select", { id: "variant", onchange: onVariant });
  const partsBox = h("div");
  const zonesBox = h("div", { class: "zones" });
  const zonesSection = h("section", { hidden: true }, zonesBox);
  const refsBox = h("div", { class: "refs" });
  const refsSection = h("section", { hidden: true }, h("span", { class: "label" }, "Referencje"), refsBox);
  const side = h("aside", { class: "side" },
    h("header", {}, h("a", { href: "#" }, "← Projekty"), title),
    h("section", {}, h("label", { class: "label", for: "variant" }, "Wariant"), variantSelect),
    h("section", {}, partsBox),
    zonesSection,
    refsSection);

  const modeButtons = {
    part: h("button", { type: "button", onclick: () => setMode("part") }, "Komponent"),
    assembled: h("button", { type: "button", onclick: () => setMode("assembled") }, "Złożona figurka"),
  };
  const workButtons = Object.fromEntries(WORKS.map(([id, label]) =>
    [id, h("button", { type: "button", onclick: () => setWork(id) }, label)]));
  const info = h("span", { class: "info" });
  const timelineBar = createTimeline({ onMove: goTo });
  const panel = createRecipePanel({
    selectRecipe, createRecipe: () => attempt(addRecipe()), deleteRecipe: id => attempt(removeRecipe(id)), changeRecipe,
    setPrimer: hex => attempt(setPrimer(hex)), toggleDone: (...mark) => attempt(toggleDone(...mark)), goTo,
    refreshInventory: () => attempt(refreshInventory()),
  });

  const toolButtons = Object.fromEntries(TOOLS.map(([id, label]) =>
    [id, h("button", { type: "button", onclick: () => setTool(id) }, label)]));
  const viewButtons = Object.fromEntries(VIEWS.map(([id, label]) =>
    [id, h("button", { type: "button", onclick: () => setView(id) }, label)]));
  const sizeValue = h("output", { for: "brush-size" });
  const sizeInput = h("input", {
    id: "brush-size", type: "range", min: "0.3", max: "15", step: "0.1", value: String(state.radius),
    oninput: () => { state.radius = Number(sizeInput.value); syncTools(); },
  });
  const stayInput = h("input", {
    id: "stay-in-patch", type: "checkbox", onchange: () => { state.stayInPatch = stayInput.checked; syncTools(); },
  });
  const emptyInput = h("input", {
    id: "only-empty", type: "checkbox", onchange: () => { state.onlyEmpty = emptyInput.checked; },
  });
  const undoButton = h("button", { type: "button", class: "plain", onclick: undo }, "Cofnij");
  const redoButton = h("button", { type: "button", class: "plain", onclick: redo }, "Ponów");
  const fillButton = h("button", {
    type: "button", class: "plain", onclick: fillRest,
    title: "Przypisz do aktywnej strefy wszystko, co nie ma jeszcze strefy",
  }, "Wypełnij resztę");
  const saveStatus = h("span", { class: "save-status", role: "status" });
  const angleValue = h("output", { for: "cut-angle" });
  const angleInput = h("input", {
    id: "cut-angle", type: "range", min: "10", max: "60", step: "1",
    oninput: () => showCut(),
  });
  const minValue = h("output", { for: "cut-min" });
  const minInput = h("input", {
    id: "cut-min", type: "range", min: "0", max: "1", step: "0.01",
    oninput: () => showCut(),
  });
  function showCut() {
    angleValue.textContent = `${angleInput.value}°`;
    minValue.textContent = `${Number(minInput.value).toFixed(2)}%`;
  }
  const cutButton = h("button", { type: "button", class: "plain", onclick: recut }, "Przelicz");
  const cutCount = h("span", { class: "muted" });
  const paintBar = h("div", { class: "paintbar", hidden: true },
    h("div", { class: "segmented", role: "group", "aria-label": "Narzędzie" }, Object.values(toolButtons)),
    h("label", { class: "field", for: "brush-size" }, "Rozmiar", sizeInput, sizeValue),
    h("label", { class: "field check", for: "stay-in-patch" }, stayInput, "Trzymaj się płata"),
    h("label", { class: "field check", for: "only-empty", title: "Nie zmieniaj tego, co już ma strefę" },
      emptyInput, "Tylko puste miejsca"),
    h("div", { class: "pair" }, undoButton, redoButton, fillButton),
    h("div", { class: "segmented", role: "group", "aria-label": "Widok" }, Object.values(viewButtons)),
    h("details", { class: "cut" }, h("summary", {}, "Płaty…"),
      h("div", { class: "cut-body" },
        h("label", { class: "field", for: "cut-angle" }, "Kąt cięcia", angleInput, angleValue),
        h("label", { class: "field", for: "cut-min" }, "Najmniejszy płat", minInput, minValue),
        cutButton, cutCount)),
    saveStatus);

  const canvas = h("canvas", { "aria-label": "Podgląd modelu" });
  const hint = h("div", { class: "hint" });
  const main = h("div", { class: "main" },
    h("div", { class: "toolbar" },
      h("div", { class: "segmented", role: "group", "aria-label": "Tryb widoku" },
        modeButtons.part, modeButtons.assembled),
      h("div", { class: "segmented", role: "group", "aria-label": "Praca" }, Object.values(workButtons)),
      info),
    paintBar,
    h("div", { class: "stage" }, canvas, hint),
    timelineBar.element);
  const screen = h("div", { class: "project" }, side, main, panel.element);
  root.append(screen);

  const viewer = createViewer(canvas);
  viewer.onPick(select);
  viewer.onStroke(onStroke);
  viewer.onFaceClick(onFaceClick);
  api.getInventory().then(answer => {
    paints = answer.paints;
    if (!closed && state.plan) render();
  }).catch(console.error);

  const stopWatching = api.watchPlan(slug, revision => {
    if (!state.plan || revision !== state.plan.revision) refresh();
  });
  window.addEventListener("keydown", onKey);
  refresh();

  // -- plan ---------------------------------------------------------------------------------------

  async function refresh() {
    if (fetching) { stale = true; return; }
    fetching = true;
    try {
      const plan = await api.getPlan(slug);
      if (closed) return;
      state.plan = plan;
      render();
    } catch (failure) {
      if (!closed && !state.plan) {
        root.replaceChildren(h("div", { class: "notice" },
          h("p", {}, failure.message), h("p", {}, h("a", { href: "#" }, "← Projekty"))));
      }
    } finally {
      fetching = false;
      if (stale && !closed) { stale = false; refresh(); }
    }
  }

  async function onVariant() {
    if (!variantSelect.value) return;
    state.selected = null;
    try {
      await api.chooseVariant(slug, variantSelect.value);
    } finally {
      refresh();
    }
  }

  function setMode(mode) {
    state.mode = mode;
    render();
  }

  function select(partId) {
    state.selected = partId;
    render();
  }

  function setWork(work) {
    state.work = work;
    render();
  }

  function goTo(key) {
    state.position = key;
    render();
  }

  // A change the user made did not reach the server, or was refused: say so where they are looking, and
  // show what the server really has (a tick or a typed name must not stay on screen as if it were saved).
  function failed(failure) {
    console.error(failure);
    if (closed) return;
    problem.text = failure.status ? `Nie zapisano zmiany: ${failure.message}` : "Nie zapisano zmiany — serwer nie odpowiada.";
    problem.count += 1;
    render();
    refresh();
  }

  function saved() {
    if (problem.text === null) return;
    problem.text = null;
    render();
  }

  function attempt(promise) {
    promise.then(saved, failed);
  }

  // -- recipes ------------------------------------------------------------------------------------

  async function loadSteps() {
    if (steps.loading) return;
    steps.loading = true;
    const key = stepsKey(state.plan);
    try {
      const fresh = await api.getSteps(slug);
      Object.assign(steps, { rev: steps.rev + 1, profile: fresh.profile, recipes: fresh.recipes, inventory: fresh.inventory });
    } catch (failure) {
      console.error(failure);
    } finally {
      steps.key = key;                       // also after a failure: the next change of the recipes asks again
      steps.loading = false;
    }
    if (!closed) render();
  }

  // The server's answer to a recipe change: take it over at once, the plan stream confirms it later.
  function applyRecipe({ recipe, steps: resolved }) {
    const list = state.plan.recipes;
    const at = list.findIndex(known => known.id === recipe.id);
    if (at < 0) list.push(recipe); else list[at] = recipe;
    steps.recipes[recipe.id] = resolved;
    steps.key = stepsKey(state.plan);
    steps.rev += 1;
  }

  async function changeRecipe(id, changes) {
    const turn = (changeSeq.get(id) ?? 0) + 1;
    changeSeq.set(id, turn);
    try {
      const answer = await api.updateRecipe(slug, id, changes);
      if (closed || changeSeq.get(id) !== turn) return;      // a later change is on its way and carries this one
      applyRecipe(answer);
      problem.text = null;
      render();
    } catch (failure) {
      failed(failure);
    }
  }

  // A new recipe; given a zone, it is named and coloured after the zone and the zone uses it.
  async function addRecipe(zone = null) {
    const target = paint;
    const answer = await api.createRecipe(slug, zone ? { name: zone.name, base: zone.color } : {});
    applyRecipe(answer);
    state.recipe = answer.recipe.id;
    if (zone && target) await api.updateZone(slug, target.variant, target.part.id, zone.id, { recipe: answer.recipe.id });
    await refresh();
  }

  async function removeRecipe(id) {
    await api.deleteRecipe(slug, id);
    if (state.recipe === id) state.recipe = null;
    await refresh();
  }

  function selectRecipe(id) {
    state.recipe = id;
    render();
  }

  async function setPrimer(hex) {
    const settings = await api.updateSettings(slug, { primer: hex });
    state.plan.primer = settings.primer;
    render();
  }

  async function toggleDone(recipeId, step, done) {
    const variantId = state.plan.active_variant, partId = state.selected;
    const { progress } = await api.setProgress(slug, variantId, partId, { recipe: recipeId, step, done });
    const part = activeVariant(state.plan)?.parts.find(candidate => candidate.id === partId);
    if (part && state.plan.active_variant === variantId) part.progress = progress;
    render();
  }

  async function refreshInventory() {
    const answer = await api.refreshInventory();
    paints = answer.paints;
    steps.key = null;                          // other paints, other steps
    render();
  }

  function setZoneRecipe(zone, value) {
    if (value === "+") { attempt(addRecipe(zone)); return; }
    if (value) state.recipe = value;
    editZone(zone.id, { recipe: value || null });
  }

  // A click on the model picks the zone under the pointer, and with it the recipe the panel shows.
  function onFaceClick(face) {
    const zone = paint?.part.zones.find(candidate => candidate.id === paint.edit.zones[face]);
    if (!zone) return;
    paint.activeZone = zone.id;
    if (zone.recipe) state.recipe = zone.recipe;
    render();
  }

  // -- what the model shows -----------------------------------------------------------------------

  function stageFor(part) {
    return buildStage({
      zones: part.zones, stepsByRecipe: steps.recipes, key: position, stages: steps.profile.stages,
      primer: state.plan.primer,
    });
  }

  function lookOf(part) {
    return state.work === "paint" ? { view: "paint", stage: stageFor(part) } : { view: state.view };
  }

  function lookKeyOf(part) {
    return state.work === "paint"
      ? JSON.stringify(["paint", position, steps.rev, state.plan.primer, part.zones.map(zone => [zone.id, zone.recipe])])
      : `zones:${state.view}`;
  }

  // The steps of every recipe used by what is on screen: they decide the timeline's stops.
  function stepsOnScreen(variant, selected) {
    const parts = !variant ? [] : state.mode === "part" ? (selected ? [selected] : []) : assembledParts(variant);
    const ids = new Set(parts.flatMap(part => part.zones.map(zone => zone.recipe)));
    return [...ids].filter(id => id && steps.recipes[id]).map(id => steps.recipes[id]);
  }

  // -- tools --------------------------------------------------------------------------------------

  function canPaint() {
    return !!paint && paint.part.zones.length > 0 && paint.activeZone !== null;
  }

  function setTool(tool) {
    state.tool = tool;
    syncTools();
  }

  function setView(view) {
    state.view = view;
    render();
  }

  function syncTools() {
    if (state.tool !== "orbit" && !canPaint()) state.tool = "orbit";
    for (const [id, button] of Object.entries(toolButtons)) {
      button.setAttribute("aria-pressed", String(state.tool === id));
      button.disabled = id !== "orbit" && !canPaint();
    }
    for (const [id, button] of Object.entries(viewButtons)) {
      button.setAttribute("aria-pressed", String(state.view === id));
    }
    sizeValue.textContent = `${state.radius.toFixed(1)} mm`;
    fillButton.disabled = !canPaint();
    undoButton.disabled = !paint?.edit.canUndo;
    redoButton.disabled = !paint?.edit.canRedo;
    // While painting steps are looked at, the model is only turned (and clicked to pick a zone).
    viewer.setTool({ tool: state.work === "paint" ? "orbit" : state.tool, radius: state.radius, stayInPatch: state.stayInPatch });
  }

  function onStroke({ phase, faces }) {
    if (!paint) return;
    if (phase === "begin") {
      strokeOpen = true;
      paint.edit.begin();
    } else if (phase === "paint") {
      const erasing = state.tool === "erase";
      const reach = state.onlyEmpty && !erasing ? faces.filter(face => paint.edit.zones[face] === 0) : faces;
      viewer.refreshColors(paint.edit.assign(reach, erasing ? 0 : paint.activeZone));
    } else {
      strokeOpen = false;
      if (paint.edit.commit()) changed();
      else followPlan(paint.part).catch(console.error);   // catch up on what arrived during a stroke that changed nothing
    }
  }

  // Everything not yet in a zone goes to the active one, as a single stroke that can be undone.
  function fillRest() {
    if (!canPaint()) return;
    paint.edit.begin();
    viewer.refreshColors(paint.edit.assign(unassignedFaces(paint.edit.zones), paint.activeZone));
    if (paint.edit.commit()) changed();
  }

  function undo() {
    const faces = paint?.edit.undo();
    if (faces) { viewer.refreshColors(faces); changed(); }
  }

  function redo() {
    const faces = paint?.edit.redo();
    if (faces) { viewer.refreshColors(faces); changed(); }
  }

  // The zone array changed locally: update the panel and save soon.
  function changed() {
    const target = paint;
    target.shares = zoneShares(target.edit.zones, target.mesh.areas);
    target.dirty = true;
    renderZones();
    syncTools();
    clearTimeout(target.timer);
    target.timer = setTimeout(() => save(target), SAVE_DELAY);
    saveStatus.textContent = "zapisywanie…";
  }

  // Send what is unsaved of one part. Resolves when it has nothing left to send, or the attempt failed.
  async function save(target = paint) {
    if (!target) return;
    clearTimeout(target.timer);
    while (target.saving) await target.saving;
    if (!target.dirty) return;
    target.dirty = false;
    const say = text => { if (paint === target) saveStatus.textContent = text; };
    // A zone deleted elsewhere must not be written back.
    const dropped = dropUnknownZones(target.edit.zones, new Set(target.part.zones.map(zone => zone.id)));
    if (dropped.length && paint === target) viewer.refreshColors(dropped);
    target.saving = (async () => {
      try {
        const { zones_rev: revision } = await api.putZoneFaces(
          slug, target.variant, target.part.id, target.edit.zones.slice(), target.rev);
        target.rev = revision;
        if (!target.dirty) say("zapisano");
      } catch (failure) {
        if (failure.status === 409 || failure.status === 400) {
          await reload(target);                // the zones changed elsewhere: theirs stand, start again from them
        } else {
          target.dirty = true;
          say("błąd zapisu — ponawiam");
          target.timer = setTimeout(() => save(target), RETRY_DELAY);
        }
      }
    })();
    try { await target.saving; } finally { target.saving = null; }
  }

  // Take the server's zones of a part as they are now, dropping what this page had not saved.
  async function reload(target) {
    try {
      const plan = await api.getPlan(slug);
      const part = plan.variants.find(v => v.id === target.variant)?.parts.find(p => p.id === target.part.id);
      if (!part) return;
      const zones = await api.getZoneFaces(slug, target.variant, part.id);
      target.part = part;
      target.rev = part.zones_rev;
      target.dirty = false;
      target.edit.replaceAll(zones);
      target.shares = zoneShares(zones, target.mesh.areas);
      if (paint !== target) return;
      viewer.setPaintData({ zones, zoneRgb: zoneColors(part) });
      renderZones();
      syncTools();
      saveStatus.textContent = "zmienione w innym miejscu — wczytano ponownie";
    } catch {
      if (paint === target) saveStatus.textContent = "błąd zapisu";
    }
  }

  async function recut() {
    if (!paint) return;
    const target = paint;
    cutButton.disabled = true;
    cutCount.textContent = "liczenie…";
    try {
      const result = await api.segment(slug, target.variant, target.part.id, {
        angle: Number(angleInput.value), min_area_fraction: Number(minInput.value) / 100,
      });
      const patches = await fetchArray(api.fileUrl(slug, sidecarPath(target.part, "patches")), Uint32Array);
      if (paint !== target) return;
      target.mesh.setPatches(patches);
      cutCount.textContent = `${result.patches} płatów`;
      if (state.view === "patches") viewer.refreshColors(null);
    } catch (failure) {
      cutCount.textContent = failure.message;
    } finally {
      cutButton.disabled = false;
    }
  }

  // -- zones --------------------------------------------------------------------------------------

  async function addZone() {
    if (!paint) return;
    const target = paint;
    const zone = await api.createZone(slug, target.variant, target.part.id);
    if (paint !== target) return;
    target.activeZone = zone.id;
    await refresh();
  }

  async function removeZone(zoneId) {
    if (!paint) return;
    const target = paint;
    await save(target);                                       // the server clears the faces in what it has stored
    const { zones_rev: revision } = await api.deleteZone(slug, target.variant, target.part.id, zoneId);
    if (paint !== target) return;
    target.rev = revision;
    target.confirm = null;
    viewer.refreshColors(target.edit.clearZone(zoneId));
    target.shares = zoneShares(target.edit.zones, target.mesh.areas);
    if (target.activeZone === zoneId) target.activeZone = null;
    await refresh();
  }

  async function editZone(zoneId, changes) {
    if (!paint) return;
    try {
      await api.updateZone(slug, paint.variant, paint.part.id, zoneId, changes);
    } finally {
      refresh();
    }
  }

  function renderZones() {
    const visible = !!paint && state.mode === "part";
    zonesSection.hidden = !visible;
    if (!visible) { drawn.zones = ""; return; }
    const zones = paint.part.zones;
    if (paint.activeZone === null || !zones.some(z => z.id === paint.activeZone)) {
      paint.activeZone = zones[0]?.id ?? null;
    }
    const recipes = state.plan.recipes.map(recipe => [recipe.id, recipe.name]);
    const key = JSON.stringify([paint.key, zones, paint.activeZone, paint.confirm, recipes,
      zones.map(z => Math.round((paint.shares.get(z.id) ?? 0) * 1000))]);
    if (key === drawn.zones || zonesBox.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    drawn.zones = key;
    zonesBox.replaceChildren(
      h("span", { class: "label" }, "Strefy"),
      zones.length ? "" : h("p", { class: "muted small" }, "Dodaj strefę, żeby malować."),
      h("ul", { class: "zone-list" }, zones.map(zone => h("li", {
        class: "zone", "aria-current": zone.id === paint.activeZone ? "true" : null,
        onclick: event => {
          if (event.target.closest("button, input[type=color], select")) return;
          paint.activeZone = zone.id;
          if (zone.recipe) state.recipe = zone.recipe;
          render();
        },
      },
      h("input", {
        type: "color", value: zone.color, "aria-label": `Kolor strefy ${zone.name}`,
        onchange: event => editZone(zone.id, { color: event.target.value }),
      }),
      h("input", {
        type: "text", class: "zone-name", value: zone.name, maxLength: 60, "aria-label": "Nazwa strefy",
        onfocus: () => { paint.activeZone = zone.id; syncTools(); },
        onchange: event => editZone(zone.id, { name: event.target.value }),
        onkeydown: event => { if (event.key === "Enter") event.target.blur(); },
      }),
      h("span", { class: "share" }, `${((paint.shares.get(zone.id) ?? 0) * 100).toFixed(1)}%`),
      paint.confirm === zone.id
        ? h("span", { class: "confirm" }, "Usunąć strefę?",
          h("button", { type: "button", class: "plain", onclick: () => removeZone(zone.id) }, "Tak"),
          h("button", { type: "button", class: "plain", onclick: () => { paint.confirm = null; renderZones(); } }, "Nie"))
        : h("button", {
          type: "button", class: "plain icon", title: "Usuń strefę", "aria-label": `Usuń strefę ${zone.name}`,
          onclick: () => { paint.confirm = zone.id; renderZones(); },
        }, "×"),
      h("select", {
        class: "zone-recipe", "aria-label": `Receptura strefy ${zone.name}`, title: "Receptura: jak malować tę strefę",
        onchange: event => setZoneRecipe(zone, event.target.value),
      },
      h("option", { value: "" }, "— bez receptury —"),
      recipes.map(([id, name]) => h("option", { value: id, selected: id === zone.recipe }, name)),
      h("option", { value: "+" }, "＋ Nowa z tej strefy"))))),
      h("button", { type: "button", class: "plain add", onclick: addZone }, "＋ Strefa"));
  }

  function zoneColors(part) {
    return new Map(part.zones.map(zone => [zone.id, hexToRgb(zone.color)]));
  }

  // -- stage --------------------------------------------------------------------------------------

  function leavePaint() {
    if (!paint) return;
    save(paint);                               // keeps going after the part is left; it holds its own copy
    const old = paint;
    paint = null;
    strokeOpen = false;
    setTimeout(() => old.mesh.dispose(), 0);
    saveStatus.textContent = "";
  }

  async function openPaint(variant, part, key) {
    const [mesh, zones] = await Promise.all([
      loadPaintMesh({
        meshUrl: api.fileUrl(slug, part.mesh),
        patchesUrl: api.fileUrl(slug, sidecarPath(part, "patches")),
        masksUrl: api.fileUrl(slug, sidecarPath(part, "masks")),
      }),
      api.getZoneFaces(slug, variant.id, part.id),
    ]);
    if (closed || shown !== key) { mesh.dispose(); return; }
    paint = {
      key, variant: variant.id, part, mesh, edit: new ZoneEdit(zones), rev: part.zones_rev,
      colors: JSON.stringify(part.zones.map(z => [z.id, z.color])), activeZone: part.zones[0]?.id ?? null,
      shares: zoneShares(zones, mesh.areas), confirm: null,
      dirty: false, saving: null, timer: null, following: false,
    };
    angleInput.value = String(part.segmentation.angle);
    minInput.value = String(part.segmentation.min_area_fraction * 100);
    showCut();
    cutCount.textContent = `${part.patches} płatów`;
    lookKey = lookKeyOf(part);
    viewer.showPaint(mesh, { zones: paint.edit.zones, zoneRgb: zoneColors(part), ...lookOf(part) });
    render();
  }

  // The plan moved on while a part is being painted: take over what changed elsewhere.
  async function followPlan(part) {
    paint.part = part;
    const colors = JSON.stringify(part.zones.map(z => [z.id, z.color]));
    if (colors !== paint.colors) {
      paint.colors = colors;
      viewer.setPaintData({ zoneRgb: zoneColors(part) });
    }
    const target = paint;
    if (part.zones_rev !== target.rev && !target.dirty && !target.saving && !strokeOpen && !target.following) {
      target.following = true;
      try {
        const revision = part.zones_rev;
        const zones = await api.getZoneFaces(slug, target.variant, part.id);
        if (paint !== target || target.dirty || strokeOpen) return;   // the next save will find out (409)
        target.rev = revision;
        target.edit.replaceAll(zones);
        target.shares = zoneShares(zones, target.mesh.areas);
        viewer.setPaintData({ zones });
        renderZones();
        syncTools();
      } finally {
        target.following = false;
      }
    }
  }

  // What colouring a part of the figure needs. The zone array is fetched again only when it has changed,
  // so moving the timeline over the whole figure costs no request.
  async function figureData(variant, part) {
    const key = `${variant.id}/${part.id}`;
    const known = figure.get(key);
    if (known?.rev === part.zones_rev) return known;
    const [lodmap, lodmasks, zones] = await Promise.all([
      known?.lodmap ?? fetchArray(api.fileUrl(slug, sidecarPath(part, "lodmap")), Uint32Array),
      known?.lodmasks ?? fetchArray(api.fileUrl(slug, sidecarPath(part, "lodmasks")), Uint8Array),
      api.getZoneFaces(slug, variant.id, part.id),
    ]);
    const data = { rev: part.zones_rev, zones, lodmap, lodmasks };
    figure.set(key, data);
    return data;
  }

  async function assembledPart(variant, part) {
    const base = { id: part.id, url: api.fileUrl(slug, part.mesh_lod) };
    if (!paintable(part) || part.zones.length === 0) return base;
    const data = await figureData(variant, part);
    if (state.work === "paint") {
      const stage = stageFor(part);
      if (stage.byZone.size === 0) return base;              // no recipe on this part: primer
      return {
        ...base, faceRgb: lodStageColors(data.lodmap, data.zones, data.lodmasks, stage),
        colorKey: `${part.zones_rev}:${lookKeyOf(part)}`,
      };
    }
    return {
      ...base, faceRgb: lodFaceColors(data.lodmap, data.zones, zoneColors(part)),
      colorKey: `${part.zones_rev}:${JSON.stringify(part.zones.map(z => z.color))}`,
    };
  }

  function syncViewer(variant, selected) {
    const failed = error => { shown = ""; hint.textContent = "Nie udało się wczytać siatki."; console.error(error); };
    if (!variant || !selected) {
      leavePaint();
      if (shown) viewer.clear();
      shown = "";
      return;
    }
    if (state.mode === "part") {
      const key = `${paintable(selected) ? "paint" : "part"}:${variant.id}:${selected.id}`;
      if (key === shown) {
        if (paint) followPlan(selected).catch(console.error);
        return;
      }
      leavePaint();
      shown = key;
      if (paintable(selected)) openPaint(variant, selected, key).catch(failed);
      else viewer.showPart({ id: selected.id, url: api.fileUrl(slug, selected.mesh) }).catch(failed);
      return;
    }
    const parts = assembledParts(variant);
    const look = state.work === "paint" ? `paint:${position}:${steps.rev}:${state.plan.primer}` : "zones";
    const key = `assembled:${variant.id}:${look}:`
      + parts.map(p => `${p.id}@${p.zones_rev}:${p.zones.map(z => [z.color, z.recipe])}`).join(",");
    if (key === shown) {
      viewer.setSelected(selected.id);
      return;
    }
    const pending = paint ? save(paint) : Promise.resolve();     // the figure is coloured from what is stored
    leavePaint();
    shown = key;
    const ticket = ++assembledTicket;
    pending.then(() => Promise.all(parts.map(part => assembledPart(variant, part)))).then(ready => {
      if (closed || ticket !== assembledTicket || shown !== key) return;
      return viewer.showAssembled(ready, selected.id);
    }).catch(failed);
  }

  // -- references ---------------------------------------------------------------------------------

  function onKey(event) {
    const focused = document.activeElement;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(focused?.tagName)
      && focused.type !== "range" && focused.type !== "checkbox";
    const action = keyAction(event, { work: state.work, typing, onSlider: focused?.type === "range" });
    if (action === "close") closeLightbox();
    else if (action === "undo") { event.preventDefault(); undo(); }
    else if (action === "redo") { event.preventDefault(); redo(); }
    else if (action === "back" || action === "forward") {
      if (timelineBar.nudge(action === "back" ? -1 : 1)) event.preventDefault();
    }
  }

  function openLightbox(reference) {
    closeLightbox();
    lightbox = h("div", { class: "lightbox", role: "dialog", "aria-label": reference.id, onclick: closeLightbox },
      h("img", { src: api.fileUrl(slug, reference.file), alt: reference.id, onclick: e => e.stopPropagation() }));
    document.body.append(lightbox);
  }

  function closeLightbox() {
    lightbox?.remove();
    lightbox = null;
  }

  // -- render -------------------------------------------------------------------------------------

  function render() {
    const plan = state.plan;
    const variant = activeVariant(plan);
    document.title = `${plan.name} · warpaint-model`;
    title.textContent = plan.name;

    const variantsKey = JSON.stringify([plan.active_variant, plan.variants.map(v => [v.id, v.name, v.kind])]);
    if (variantsKey !== drawn.variants) {
      drawn.variants = variantsKey;
      variantSelect.replaceChildren(
        ...(variant ? [] : [h("option", { value: "" }, "— wybierz —")]),
        ...plan.variants.map(v => h("option", { value: v.id }, `${v.name} · ${KIND_LABEL[v.kind]}`)));
      variantSelect.value = plan.active_variant ?? "";
    }

    if (variant) {
      const selectedPart = variant.parts.find(p => p.id === state.selected);
      if (!selectedPart || selectedPart.status !== "ready") {
        state.selected = firstViewablePart(variant)?.id ?? null;
      }
    } else {
      state.selected = null;
    }
    const selected = variant?.parts.find(p => p.id === state.selected) ?? null;

    const scroll = side.scrollTop;
    partsBox.replaceChildren(...(variant ? partsList(variant) : []));
    side.scrollTop = scroll;

    const refs = plan.references.filter(r => r.status === "ready");
    const refsKey = refs.map(r => r.id).join(",");
    if (refsKey !== drawn.refs) {
      drawn.refs = refsKey;
      refsSection.hidden = refs.length === 0;
      refsBox.replaceChildren(...referenceRows(refs));
    }

    for (const [mode, button] of Object.entries(modeButtons)) {
      button.setAttribute("aria-pressed", String(state.mode === mode));
    }
    for (const [work, button] of Object.entries(workButtons)) {
      button.setAttribute("aria-pressed", String(state.work === work));
    }
    if (steps.key !== stepsKey(plan)) loadSteps();
    const painting = state.work === "paint";
    const stages = steps.profile.stages;
    positions = timeline(stages, stepsOnScreen(variant, selected));
    // Until the steps have arrived there is only the primer to stand on; the choice is kept for when they do.
    position = settle(positions, state.position, stages);
    viewer.setPrimer(painting ? plan.primer : NEUTRAL);
    viewer.setEmphasis(painting ? "mild" : "strong");
    info.textContent = selected
      ? `${selected.name} · ${selected.tris.toLocaleString("pl-PL")} trójkątów`
        + (selected.tris_source > selected.tris ? ` (z ${selected.tris_source.toLocaleString("pl-PL")})` : "")
      : "";
    hint.textContent = !variant ? "Wybierz wariant" : selected ? "" : "Przetwarzanie części…";

    syncViewer(variant, selected);
    if (paint && state.mode === "part" && lookKeyOf(paint.part) !== lookKey) {
      lookKey = lookKeyOf(paint.part);
      viewer.setPaintData(lookOf(paint.part));
    }
    paintBar.hidden = !(paint && state.mode === "part") || painting;
    renderZones();
    syncTools();

    timelineBar.element.hidden = !painting;
    timelineBar.update(positions, position);
    screen.classList.toggle("with-panel", painting);
    panel.element.hidden = !painting;
    if (!painting) return;
    if (!plan.recipes.some(recipe => recipe.id === state.recipe)) {
      const active = paint?.part.zones.find(zone => zone.id === paint.activeZone)?.recipe;
      state.recipe = active ?? selected?.zones.find(zone => zone.recipe)?.recipe ?? plan.recipes[0]?.id ?? null;
    }
    const recipe = plan.recipes.find(candidate => candidate.id === state.recipe) ?? null;
    panel.update({
      plan, recipe, steps: (recipe && steps.recipes[recipe.id]) ?? [], part: selected, position, stages, paints,
      inventory: steps.inventory, problem,
      usedBy: !recipe || !variant ? [] : variant.parts.flatMap(part =>
        part.zones.filter(zone => zone.recipe === recipe.id).map(zone => `${part.name} · ${zone.name}`)),
    });
  }

  function partsList(variant) {
    const { ready, total, failed } = progress(variant);
    const summary = `${ready} z ${total} gotowych` + (failed ? ` · ${failed} z błędem` : "");
    return [
      h("span", { class: "label" }, summary),
      h("ul", { class: "parts" }, variant.parts.map(part => h("li", {},
        h("button", {
          class: "part", type: "button", disabled: part.status !== "ready",
          "data-status": part.status, "data-outlier": String(part.outlier),
          "aria-current": part.id === state.selected ? "true" : null,
          onclick: () => select(part.id),
        },
        h("span", { class: "name", title: part.name }, part.name),
        partStatus(part),
        part.status === "error" ? h("span", { class: "detail" }, part.error) : null)))),
    ];
  }

  // Beside a part's name: its state, then how many zones it has, then how many painting steps are done.
  function partStatus(part) {
    if (part.outlier) return h("span", { class: "status" }, "pominięty");
    if (part.status !== "ready" || part.zones.length === 0) return h("span", { class: "status" }, STATUS_LABEL[part.status]);
    const marks = progressOf(part, steps.recipes);
    return marks.total
      ? h("span", { class: "status", title: `Zrobione kroki malowania: ${marks.done} z ${marks.total}` }, `${marks.done}/${marks.total}`)
      : h("span", { class: "status" }, `${part.zones.length} ${zoneWord(part.zones.length)}`);
  }

  function referenceRows(refs) {
    const roles = [...new Set(refs.map(r => r.role))];
    return roles.map(role => h("div", {},
      h("div", { class: "role" }, ROLE_LABEL[role]),
      h("div", { class: "ref-row" }, refs.filter(r => r.role === role).map(reference =>
        h("button", { class: "ref", type: "button", title: reference.id, onclick: () => openLightbox(reference) },
          h("img", { src: api.fileUrl(slug, reference.file), alt: reference.id, loading: "lazy" }))))));
  }

  window.__planner = { viewer, state, steps, get paint() { return paint; }, get position() { return position; } };   // for checks from the console

  return () => {
    closed = true;
    if (paint) save(paint);
    stopWatching();
    window.removeEventListener("keydown", onKey);
    closeLightbox();
    viewer.dispose();
    paint?.mesh.dispose();
    delete window.__planner;
  };
}

function zoneWord(count) {
  if (count === 1) return "strefa";
  const tens = count % 100, ones = count % 10;
  return ones >= 2 && ones <= 4 && !(tens >= 12 && tens <= 14) ? "strefy" : "stref";
}

// Start only now: the screens above use constants that must exist first.
window.addEventListener("hashchange", route);
route();
