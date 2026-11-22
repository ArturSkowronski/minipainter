import assert from "node:assert/strict";
import test from "node:test";

import {
  FORMAT_LABEL, HOW, NOTHING_HERE, STAGE_LABEL, WHERE, buildStage, compile, exposure, mixText, nearestFirst, opsAt,
  paintPlan, progressOf, settle, shade, stageSummary, stepAt, stepLabel, stepsKey, timeline,
} from "../stagemodel.js";

const STAGES = ["primer", "base", "layers", "shade", "lining", "highlight", "ink"];
const PRIMER = [139, 142, 147];

function step(key, color, extra = {}) {
  const layer = /^layer:(\d)$/.exec(key);
  return {
    key, stage: layer ? "layers" : key, index: layer ? Number(layer[1]) : null, of: null, color,
    paint: null, mix: null, threshold: null, ...extra,
  };
}

function layered(count, extra = []) {
  return [
    step("base", "#b3202a"),
    ...Array.from({ length: count }, (_, i) => step(`layer:${i + 1}`, "#d04838", { of: count })),
    step("shade", "#5a1a1a"), ...extra, step("highlight", "#e8705a"),
  ];
}

const two = layered(2);
const four = layered(4, [step("lining", "#1a1a1a", { threshold: 0.5 })]);
const keysOf = positions => positions.map(p => p.key);

function shaded(steps, key, { cavity = 0, ridge = 0, up = 0 } = {}, positions = timeline(STAGES, [steps])) {
  const ops = compile(steps);
  const out = new Uint8Array(3);
  shade(ops, opsAt(ops, key, STAGES), cavity, ridge, up, PRIMER, out, 0);
  return Array.from(out);
}

test("the timeline has one stop per stage on screen and as many layers as the longest recipe", () => {
  assert.deepEqual(keysOf(timeline(STAGES, [two, four])),
    ["primer", "base", "layer:1", "layer:2", "layer:3", "layer:4", "shade", "lining", "highlight"]);
  assert.deepEqual(keysOf(timeline(STAGES, [two])), ["primer", "base", "layer:1", "layer:2", "shade", "highlight"]);
  assert.deepEqual(keysOf(timeline(STAGES, [])), ["primer"]);
  assert.deepEqual(timeline(STAGES, [two])[2], { key: "layer:1", stage: "layers", index: 1 });
  // The order is the profile's, not the recipe's.
  assert.deepEqual(keysOf(timeline(["primer", "base", "shade", "layers", "highlight"], [two])),
    ["primer", "base", "shade", "layer:1", "layer:2", "highlight"]);
});

test("a position that is gone settles on the nearest earlier one", () => {
  const short = timeline(STAGES, [layered(3)]);
  assert.equal(settle(short, "layer:2", STAGES), "layer:2");
  assert.equal(settle(short, "layer:5", STAGES), "layer:3");
  assert.equal(settle(short, "lining", STAGES), "shade");
  assert.equal(settle(short, "ink", STAGES), "highlight");
  assert.equal(settle(timeline(STAGES, [layered(0)]), "layer:1", STAGES), "base");
  assert.equal(settle(short, null, STAGES), "highlight");
  assert.equal(settle(short, "nonsense", STAGES), "highlight");
  assert.equal(settle(timeline(STAGES, []), "shade", STAGES), "primer");
});

test("labels", () => {
  assert.equal(stepLabel({ key: "layer:2", stage: "layers", index: 2 }), "Warstwa 2");
  assert.equal(stepLabel({ key: "shade", stage: "shade" }), "Cień");
  assert.equal(stepLabel({ key: "primer", stage: "primer" }), "Podkład");
  for (const stage of STAGES) assert.ok(STAGE_LABEL[stage] && WHERE[stage] && HOW[stage], stage);
  for (const format of ["opaque_base", "opaque_layer", "wash", "contrast", "technical", "drybrush", "metallic", "ink"]) {
    assert.ok(FORMAT_LABEL[format], format);
  }
  assert.equal(mixText({ mix: [{ parts: 2 }, { parts: 1 }] }), "2 : 1");
  assert.equal(mixText({ mix: null }), "");
});

test("a recipe with fewer layers stops changing earlier", () => {
  const ops = compile(two);
  assert.equal(opsAt(ops, "primer", STAGES), 0);
  assert.equal(opsAt(ops, "base", STAGES), 1);
  assert.equal(opsAt(ops, "layer:2", STAGES), 3);
  assert.equal(opsAt(ops, "layer:4", STAGES), 3);
  assert.equal(opsAt(ops, "shade", STAGES), 4);
  assert.equal(opsAt(ops, "lining", STAGES), 4);          // this recipe has no lining: nothing new
  assert.equal(opsAt(ops, "ink", STAGES), 5);
  assert.deepEqual(shaded(two, "layer:4", { ridge: 0.6 }), shaded(two, "layer:2", { ridge: 0.6 }));
});

test("primer and base are flat", () => {
  assert.deepEqual(shaded(two, "primer", { cavity: 1 }), PRIMER);
  for (const point of [{}, { cavity: 1 }, { ridge: 1, up: 1 }, { up: -1 }]) {
    assert.deepEqual(shaded(two, "base", point), [179, 32, 42]);
  }
});

const red = rgb => rgb[1];        // the green channel tells base #b3202a (32) from layer #d04838 (72)

test("layers reach exposed surfaces first and later layers cover less", () => {
  const three = layered(3);
  const exposed = { ridge: 0.7, up: 1 }, flat = {}, recessed = { cavity: 0.7 };
  assert.ok(exposure(0, 0.7, 1) > exposure(0, 0, 0) && exposure(0, 0, 0) > exposure(0.7, 0, 0));
  assert.equal(exposure(1, 0, -1), 0);
  assert.equal(exposure(0, 1, 1), 1);
  assert.ok(red(shaded(three, "layer:1", exposed)) > red(shaded(three, "layer:1", recessed)));
  assert.deepEqual(shaded(three, "layer:1", recessed), [179, 32, 42]);
  assert.deepEqual(shaded(three, "layer:3", exposed), [208, 72, 56]);
  // At an ordinary point the first layer goes on, the last does not.
  assert.ok(red(shaded(three, "layer:1", flat)) > 60);
  assert.deepEqual(shaded(three, "layer:3", flat), shaded(three, "layer:2", flat));
  // A single layer behaves like the first of several.
  assert.deepEqual(shaded(layered(1), "layer:1", flat), shaded(three, "layer:1", flat));
});

test("shade darkens recesses most and tints towards the wash", () => {
  const sum = rgb => rgb[0] + rgb[1] + rgb[2];
  const before = shaded(layered(0), "base", { cavity: 0.8 });
  const deep = shaded(layered(0), "shade", { cavity: 0.8 });
  const open = shaded(layered(0), "shade", { cavity: 0 });
  assert.ok(sum(deep) < sum(open) && sum(open) < sum(before));
  assert.ok(sum(before) - sum(open) < 30);                 // a wash stains everything a little
  const blueWash = [step("base", "#808080"), step("shade", "#1a2a5a")];
  const tinted = shaded(blueWash, "shade", { cavity: 1 });
  assert.ok(tinted[2] > tinted[0] && tinted[0] < 100);
});

test("lining is a sharp line where the recess is deep enough", () => {
  const lined = [step("base", "#b3202a"), step("lining", "#1a1a1a", { threshold: 0.5 })];
  assert.deepEqual(shaded(lined, "lining", { cavity: 0.49 }), [179, 32, 42]);
  const line = shaded(lined, "lining", { cavity: 0.5 });
  assert.ok(line[0] < 50 && line[1] < 35);
  assert.deepEqual(shaded(lined, "lining", { cavity: 1 }), line);
});

test("highlight sits on ridges only", () => {
  const plain = [step("base", "#b3202a"), step("highlight", "#e8705a")];
  assert.deepEqual(shaded(plain, "highlight", { ridge: 0 }), [179, 32, 42]);
  assert.deepEqual(shaded(plain, "highlight", { ridge: 0.2, up: 1 }), [179, 32, 42]);
  assert.deepEqual(shaded(plain, "highlight", { ridge: 1 }), [232, 112, 90]);
  assert.deepEqual(shaded(plain, "highlight", { ridge: 0.6 }), [179, 32, 42]);
  const edge = shaded(plain, "highlight", { ridge: 0.75 });
  assert.ok(edge[1] > 32 && edge[1] < 112);
});

test("ink tints and never lightens", () => {
  const inked = [step("base", "#c0c0c0"), step("ink", "#a82a2a")];
  const before = shaded(inked, "base"), after = shaded(inked, "ink");
  assert.ok(after.every((c, k) => c <= before[k]));
  assert.ok(after[0] - after[1] > 40);                     // clearly red now
});

test("progress counts the steps of the recipes a part uses", () => {
  const stepsByRecipe = { r1: two, r2: layered(0), r3: four };
  const part = {
    zones: [{ id: 1, recipe: "r1" }, { id: 2, recipe: "r2" }, { id: 3, recipe: "r1" }, { id: 4, recipe: null },
      { id: 5, recipe: "r9" }],
    progress: { r1: ["base", "layer:1", "layer:4"], r2: ["shade"], r3: ["base"] },
  };
  // r1 has 5 steps and r2 has 3; "layer:4" is not a step of r1 any more and r3 is not on this part.
  assert.deepEqual(progressOf(part, stepsByRecipe), { done: 3, total: 8 });
  assert.deepEqual(progressOf({ zones: [], progress: {} }, stepsByRecipe), { done: 0, total: 0 });
});

test("what makes fetched steps stale", () => {
  const plan = { recipes: [{ id: "r1", layers: 2 }], bottle_distance: 0.04, stage_profile: "layered", revision: 5 };
  assert.equal(stepsKey(plan), stepsKey({ ...plan, revision: 9, primer: "#000000" }));
  assert.notEqual(stepsKey(plan), stepsKey({ ...plan, recipes: [{ id: "r1", layers: 3 }] }));
  assert.notEqual(stepsKey(plan), stepsKey({ ...plan, bottle_distance: 0.1 }));
});

test("the stage of a part: what each zone shows at a position", () => {
  const zones = [{ id: 1, recipe: "r1" }, { id: 2, recipe: null }, { id: 3, recipe: "gone" }, { id: 7, recipe: "r3" }];
  const stage = buildStage({ zones, stepsByRecipe: { r1: two, r3: four }, key: "layer:1", stages: STAGES, primer: "#101010" });
  assert.deepEqual(stage.primer, [16, 16, 16]);
  assert.deepEqual([...stage.byZone.keys()], [1, 7]);
  assert.equal(stage.byZone.get(1).count, 2);
  const out = new Uint8Array(3);
  shade(stage.byZone.get(1).ops, stage.byZone.get(1).count, 0, 1, 1, stage.primer, out, 0);
  assert.deepEqual(Array.from(out), [208, 72, 56]);
});

test("the step a recipe is at when the timeline stands somewhere", () => {
  assert.equal(stepAt(two, "primer", STAGES), null);
  assert.equal(stepAt(two, "base", STAGES).key, "base");
  assert.equal(stepAt(two, "layer:4", STAGES).key, "layer:2");
  assert.equal(stepAt(two, "lining", STAGES).key, "shade");
  assert.equal(stepAt(two, "ink", STAGES).key, "highlight");
  assert.equal(stepAt([], "base", STAGES), null);
});

test("paints nearest a colour come first", () => {
  const paints = [{ id: "blue", hex: "#2a5caa" }, { id: "red", hex: "#b3202a" }, { id: "orange", hex: "#e05a20" }];
  assert.deepEqual(nearestFirst(paints, "#c82828").map(p => p.id), ["red", "orange", "blue"]);
  assert.deepEqual(paints.map(p => p.id), ["blue", "red", "orange"]);       // the list given is left alone
});

// -- "this stage" view: where the paint of the stage on the timeline goes -----------------------------

function focused(steps, key, point = {}) {
  const stage = buildStage({ zones: [{ id: 1, recipe: "r" }], stepsByRecipe: { r: steps }, key, stages: STAGES, primer: "#8b8e93", focus: true });
  const entry = stage.byZone.get(1);
  const out = new Uint8Array(3);
  shade(entry.ops, entry.count, point.cavity ?? 0, point.ridge ?? 0, point.up ?? 0, stage.primer, out, 0, entry.focus);
  return Array.from(out);
}
const spread = rgb => Math.max(...rgb) - Math.min(...rgb);

test("the stage view shows this stage's paint in full where it goes and mutes the rest", () => {
  const three = layered(3);
  // Layer 3 reaches an exposed point: there it is the layer's own colour, not a blend with what is under it.
  assert.deepEqual(focused(three, "layer:3", { ridge: 0.7, up: 1 }), [208, 72, 56]);
  // An ordinary point is not reached by layer 3: nearly colourless, and clearly not the result's red.
  const untouched = focused(three, "layer:3");
  assert.ok(spread(untouched) < 30, String(untouched));
  assert.ok(spread(shaded(three, "layer:3")) > 100);
  // The first layer does reach it.
  assert.deepEqual(focused(three, "layer:1"), [208, 72, 56]);
  // Base: the whole zone in the base paint, whatever the relief.
  assert.deepEqual(focused(three, "base", { cavity: 1 }), [179, 32, 42]);
  // Shade: the wash itself in a recess, close to colourless on open surface.
  assert.deepEqual(focused(three, "shade", { cavity: 0.8 }), [90, 26, 26]);
  assert.ok(spread(focused(three, "shade")) < 45);
  // Highlight: only the edge.
  assert.deepEqual(focused(three, "highlight", { ridge: 1 }), [232, 112, 90]);
  assert.ok(spread(focused(three, "highlight")) < 30);
});

test("a zone with nothing to do at this stage is muted as a whole", () => {
  // The recipe has two layers; the timeline stands on a fourth that another recipe has.
  const stage = buildStage({ zones: [{ id: 1, recipe: "r" }], stepsByRecipe: { r: two }, key: "layer:4", stages: STAGES, primer: "#8b8e93", focus: true });
  assert.equal(stage.byZone.get(1).focus, NOTHING_HERE);
  assert.ok(spread(focused(two, "layer:4", { ridge: 1, up: 1 })) < 30);
  assert.ok(spread(focused(two, "lining", { cavity: 1 })) < 30);
  // Without the stage view nothing is muted, and the entry says so.
  const plain = buildStage({ zones: [{ id: 1, recipe: "r" }], stepsByRecipe: { r: two }, key: "layer:4", stages: STAGES, primer: "#8b8e93" });
  assert.equal(plain.byZone.get(1).focus, -1);
  // On the primer everything is primer in both views.
  assert.deepEqual(focused(two, "primer", { cavity: 1 }), PRIMER);
});

test("the stage view finds the step of the stage in each recipe", () => {
  const stage = buildStage({
    zones: [{ id: 1, recipe: "a" }, { id: 2, recipe: "b" }], stepsByRecipe: { a: two, b: four }, key: "lining",
    stages: STAGES, primer: "#8b8e93", focus: true,
  });
  assert.equal(stage.byZone.get(1).focus, NOTHING_HERE);
  assert.equal(stage.byZone.get(2).ops[stage.byZone.get(2).focus].key, "lining");
});

// -- the painting written out per area ---------------------------------------------------------------

const RECIPES = [{ id: "r1", name: "Czerwień", base: "#b3202a" }, { id: "r2", name: "Błękit", base: "#2a5caa" },
  { id: "r3", name: "Czerń", base: "#1b1b1d" }];

test("the plan of a part lists every colour with the areas it covers", () => {
  const part = { zones: [{ id: 1, name: "Tors", recipe: "r1" }, { id: 2, name: "Panele", recipe: "r2" },
    { id: 3, name: "Maska", recipe: "r1" }, { id: 4, name: "Pasek", recipe: null }, { id: 5, name: "Stare", recipe: "gone" }] };
  const plan = paintPlan(part, RECIPES, { r1: two, r2: four, r3: layered(0) }, "r3");
  assert.deepEqual(plan.blocks.map(block => [block.recipe.id, block.zones, block.steps.length]),
    [["r1", ["Tors", "Maska"], 5], ["r2", ["Panele"], 8], ["r3", [], 3]]);     // the shown recipe comes last, unused here
  assert.deepEqual(plan.unassigned, ["Pasek", "Stare"]);
  assert.deepEqual(paintPlan(part, RECIPES, { r1: two, r2: four }, "r1").blocks.map(block => block.recipe.id), ["r1", "r2"]);
  assert.deepEqual(paintPlan(null, RECIPES, { r1: two }, null), { blocks: [], unassigned: [] });
  // A recipe whose steps have not arrived yet still shows, without steps.
  assert.deepEqual(paintPlan({ zones: [] }, RECIPES, {}, "r2").blocks.map(block => [block.recipe.id, block.steps]), [["r2", []]]);
});

test("what each colour gets at the stage the timeline stands on", () => {
  const { blocks } = paintPlan({ zones: [{ id: 1, name: "Tors", recipe: "r1" }, { id: 2, name: "Panele", recipe: "r2" }] },
    RECIPES, { r1: two, r2: four }, null);
  const at = key => stageSummary(blocks, key, STAGES).map(row => [row.recipe.id, row.step?.key ?? null, row.last?.key ?? null]);
  assert.deepEqual(at("layer:2"), [["r1", "layer:2", "layer:2"], ["r2", "layer:2", "layer:2"]]);
  assert.deepEqual(at("layer:3"), [["r1", null, "layer:2"], ["r2", "layer:3", "layer:3"]]);
  assert.deepEqual(at("lining"), [["r1", null, "shade"], ["r2", "lining", "lining"]]);
  assert.deepEqual(at("primer"), [["r1", null, null], ["r2", null, null]]);
});
