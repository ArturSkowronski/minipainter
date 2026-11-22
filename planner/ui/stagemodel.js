// Painting stages without the DOM or three.js: the timeline, and the colour of a point of the model after a
// given stage. An indication of where paint goes and roughly what colour it is, not a simulation. Tested with node.
import { hexToRgb } from "./zonesmodel.js";

export const STAGE_LABEL = {
  primer: "Podkład", base: "Baza", layers: "Warstwa", shade: "Cień", lining: "Linie", highlight: "Rozjaśnienie",
  ink: "Tusz",
};

export const WHERE = {
  primer: "Cała figurka.",
  base: "Cała strefa, równo, aż podkład przestanie prześwitywać.",
  layers: "Powierzchnie wypukłe i zwrócone ku górze; zagłębienia zostają w poprzednim kolorze. Każda kolejna warstwa zajmuje mniej miejsca.",
  shade: "Cała strefa cienko, tak żeby farba zebrała się w zagłębieniach i załamaniach.",
  lining: "Tylko najgłębsze rowki i styki, cienką linią.",
  highlight: "Najostrzejsze krawędzie i najwyższe punkty.",
  ink: "Cała strefa, jedną cienką warstwą.",
};

export const HOW = {
  primer: "Cienko i równo, z kilku stron.",
  base: "Dwie–trzy cienkie warstwy zamiast jednej grubej.",
  layers: "Farba rozcieńczona, pędzel prawie suchy; granicę z poprzednią warstwą rozciągnij wilgotnym pędzlem.",
  shade: "Nie zalewaj: nadmiar zbierz czystym pędzlem z płaskich powierzchni.",
  lining: "Cienki pędzel, farba rozcieńczona tak, żeby sama wpływała w rowek.",
  highlight: "Bokiem pędzla po krawędzi, bardzo mało farby.",
  ink: "Mocno rozcieńczony, bez zacieków; można powtórzyć po wyschnięciu.",
};

export const FORMAT_LABEL = {
  opaque_base: "base", opaque_layer: "layer", wash: "wash", contrast: "contrast", technical: "technical",
  drybrush: "dry", metallic: "metalik", ink: "tusz",
};

const MAX_LAYERS = 6;
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

function smooth(from, to, x) {
  const t = clamp01((x - from) / (to - from));
  return t * t * (3 - 2 * t);
}

export function stepLabel(position) {
  return position.stage === "layers" ? `${STAGE_LABEL.layers} ${position.index}` : STAGE_LABEL[position.stage];
}

export function mixText(step) {
  return step.mix ? step.mix.map(part => part.parts).join(" : ") : "";
}

// Every position a profile can have, in its order: the rank of a key is its index here.
function allKeys(stages) {
  return stages.flatMap(stage =>
    (stage === "layers" ? Array.from({ length: MAX_LAYERS }, (_, i) => `layer:${i + 1}`) : [stage]));
}

// The stops of the slider for what is on screen: the primer, then every stage some recipe there uses, with
// as many layer stops as the recipe with the most layers.
export function timeline(stages, stepLists) {
  const used = new Set();
  let layers = 0;
  for (const steps of stepLists) {
    for (const step of steps) {
      used.add(step.stage);
      if (step.stage === "layers" && step.index > layers) layers = step.index;
    }
  }
  const positions = [];
  for (const stage of stages) {
    if (stage === "primer") positions.push({ key: "primer", stage });
    else if (stage === "layers") {
      for (let index = 1; index <= layers; index++) positions.push({ key: `layer:${index}`, stage, index });
    } else if (used.has(stage)) positions.push({ key: stage, stage });
  }
  return positions;
}

// Where the slider stands when `key` is not (or no longer) a stop: the nearest earlier stop; with no
// position to go by, the last one — the finished figure.
export function settle(positions, key, stages) {
  const present = new Set(positions.map(position => position.key));
  if (present.has(key)) return key;
  const order = allKeys(stages);
  for (let rank = order.indexOf(key) - 1; rank >= 0; rank--) {
    if (present.has(order[rank])) return order[rank];
  }
  return positions.length ? positions[positions.length - 1].key : null;
}

const BASE = 0, LAYER = 1, SHADE = 2, LINING = 3, HIGHLIGHT = 4, INK = 5;
const KIND = { base: BASE, layers: LAYER, shade: SHADE, lining: LINING, highlight: HIGHLIGHT, ink: INK };
const MUTED = 190;        // the light grey that everything outside the focused step leans towards

// How much a point catches paint that is put on raised, upward surfaces: 0 deep in a recess, 1 on a ridge
// facing up. cavity and ridge are 0..1, up is the y of the surface normal. Facing up counts most: on a sculpt
// covered in small raised cells (a web suit) nearly everything is a ridge of something.
export function exposure(cavity, ridge, up) {
  return clamp01(0.45 + 0.4 * up + 0.25 * ridge - 0.8 * cavity);
}

// The steps of one recipe in the form `shade` reads.
export function compile(steps) {
  return steps.map(step => {
    const [r, g, b] = hexToRgb(step.color);
    return {
      key: step.key, kind: KIND[step.stage], r, g, b,
      // Later layers need more exposure: the first reaches most of the surface, the last only the top of it.
      reach: step.stage === "layers" ? 0.3 + 0.55 * (step.index - 1) / Math.max((step.of ?? step.index) - 1, 1) : 0,
      threshold: step.threshold ?? 0.5,
    };
  });
}

// How many of a recipe's steps are done once the timeline stands at `key`.
export function opsAt(ops, key, stages) {
  const order = allKeys(stages);
  const limit = order.indexOf(key);
  let count = 0;
  while (count < ops.length && order.indexOf(ops[count].key) <= limit) count += 1;
  return count;
}

export const NOTHING_HERE = -2;     // as `focus`: this recipe has no step at the stage shown

// The colour of one point after the first `count` steps, written to out[offset..offset + 2] as sRGB bytes.
//
// `focus` chooses between two pictures. -1: the result, the model as it looks after those steps. An index
// into ops: the stage view — that step's paint at full strength where the step puts it, and everything else
// drained of colour, so that a stage reads at a glance even when its paint is close to the one before.
// NOTHING_HERE: the stage view of a zone the stage does not touch.
export function shade(ops, count, cavity, ridge, up, primer, out, offset, focus = -1) {
  let r = primer[0], g = primer[1], b = primer[2];
  if (count === 0) { out[offset] = r; out[offset + 1] = g; out[offset + 2] = b; return; }
  const open = count > 1 ? exposure(cavity, ridge, up) : 0;
  let reached = 0;                    // how much of the focused step's paint lands on this point
  for (let i = 0; i < count; i++) {
    const op = ops[i];
    let w;
    switch (op.kind) {
      case BASE:
        w = 1;
        r = op.r; g = op.g; b = op.b;
        break;
      case LAYER:
        w = smooth(op.reach - 0.12, op.reach + 0.12, open);
        r += (op.r - r) * w; g += (op.g - g) * w; b += (op.b - b) * w;
        break;
      case SHADE:
        // What is underneath, darker and pulled towards the wash; a little everywhere, fully in recesses.
        w = 0.12 + 0.88 * smooth(0.1, 0.5, cavity);
        r += (0.3 * r + 0.4 * op.r - r) * w; g += (0.3 * g + 0.4 * op.g - g) * w; b += (0.3 * b + 0.4 * op.b - b) * w;
        break;
      case LINING:
        w = cavity >= op.threshold ? 1 : 0;
        r += (op.r - r) * 0.9 * w; g += (op.g - g) * 0.9 * w; b += (op.b - b) * 0.9 * w;
        break;
      case HIGHLIGHT:
        w = smooth(0.6, 0.9, ridge);
        r += (op.r - r) * w; g += (op.g - g) * w; b += (op.b - b) * w;
        break;
      default:      // INK: a transparent film of the ink's colour
        w = 1;
        r += (r * op.r / 255 - r) * 0.55; g += (g * op.g / 255 - g) * 0.55; b += (b * op.b / 255 - b) * 0.55;
    }
    if (i === focus) reached = w;
  }
  if (focus !== -1) {
    // Drain the colour and flatten the contrast of what is there; then lay the stage's paint over it.
    const grey = 0.3 * r + 0.59 * g + 0.11 * b;
    r = (r + (grey - r) * 0.9 + MUTED) / 2; g = (g + (grey - g) * 0.9 + MUTED) / 2; b = (b + (grey - b) * 0.9 + MUTED) / 2;
    if (focus >= 0) {
      const op = ops[focus];
      r += (op.r - r) * reached; g += (op.g - g) * reached; b += (op.b - b) * reached;
    }
  }
  out[offset] = r + 0.5; out[offset + 1] = g + 0.5; out[offset + 2] = b + 0.5;
}

// The step a recipe is at once the timeline stands at `key`: the last one applied, or null before the base.
export function stepAt(steps, key, stages) {
  const order = allKeys(stages);
  const limit = order.indexOf(key);
  let found = null;
  for (const step of steps) if (order.indexOf(step.key) <= limit) found = step;
  return found;
}

// A copy of the paint list with those closest to a colour first (a quick measure, good enough to order a list).
export function nearestFirst(paints, hex) {
  const [r, g, b] = hexToRgb(hex);
  const gap = paint => {
    const [pr, pg, pb] = hexToRgb(paint.hex);
    const mean = (r + pr) / 2;
    return (2 + mean / 256) * (r - pr) ** 2 + 4 * (g - pg) ** 2 + (2 + (255 - mean) / 256) * (b - pb) ** 2;
  };
  return paints.map(paint => [gap(paint), paint]).sort((a, b) => a[0] - b[0]).map(pair => pair[1]);
}

// What the painted view needs for one part: the primer, and per zone the steps that apply at `key`.
// Zones without a recipe (or with one that is gone) are left out and stay primer-coloured.
// With `focus`, each entry also says which of its steps is the stage itself (see shade).
export function buildStage({ zones, stepsByRecipe, key, stages, primer, focus = false }) {
  const compiled = new Map();
  const byZone = new Map();
  for (const zone of zones) {
    const steps = zone.recipe ? stepsByRecipe[zone.recipe] : null;
    if (!steps) continue;
    if (!compiled.has(zone.recipe)) {
      const ops = compile(steps);
      const count = opsAt(ops, key, stages);
      const own = ops.findIndex(op => op.key === key);
      compiled.set(zone.recipe, { ops, count, focus: !focus ? -1 : own >= 0 && own < count ? own : NOTHING_HERE });
    }
    byZone.set(zone.id, compiled.get(zone.recipe));
  }
  return { primer: hexToRgb(primer), byZone };
}

// The painting of one part written out: one block per colour (recipe) used on it, in the order of its
// zones, with the areas (zone names) the colour covers. The recipe the panel shows gets a block even when
// no zone of this part uses it. `unassigned` are the zones still without a recipe.
export function paintPlan(part, recipes, stepsByRecipe, shownId) {
  const blocks = [];
  const unassigned = [];
  const known = new Map(recipes.map(recipe => [recipe.id, recipe]));
  const block = id => {
    let found = blocks.find(candidate => candidate.recipe.id === id);
    if (!found) blocks.push(found = { recipe: known.get(id), zones: [], steps: stepsByRecipe[id] ?? [] });
    return found;
  };
  for (const zone of part?.zones ?? []) {
    if (known.has(zone.recipe)) block(zone.recipe).zones.push(zone.name);
    else unassigned.push(zone.name);
  }
  if (known.has(shownId)) block(shownId);
  return { blocks, unassigned };
}

// For each block of a plan: the step that is the stage at `key` (null when that colour has nothing to do at
// this stage) and the last step done by then (null before its base).
export function stageSummary(blocks, key, stages) {
  return blocks.map(({ recipe, zones, steps }) => ({
    recipe, zones, step: steps.find(step => step.key === key) ?? null, last: stepAt(steps, key, stages),
  }));
}

// Steps done and steps there are, over the recipes a part's zones use.
export function progressOf(part, stepsByRecipe) {
  let done = 0, total = 0;
  for (const recipe of new Set(part.zones.map(zone => zone.recipe))) {
    const steps = recipe ? stepsByRecipe[recipe] : null;
    if (!steps) continue;
    const marks = new Set(part.progress?.[recipe] ?? []);
    total += steps.length;
    done += steps.filter(step => marks.has(step.key)).length;
  }
  return { done, total };
}

// Fetched steps are stale when this changes.
export function stepsKey(plan) {
  return JSON.stringify([plan.recipes, plan.bottle_distance, plan.stage_profile]);
}
