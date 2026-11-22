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

// How much a point catches paint that is put on raised, upward surfaces: 0 deep in a recess, 1 on a ridge
// facing up. cavity and ridge are 0..1, up is the y of the surface normal.
export function exposure(cavity, ridge, up) {
  return clamp01(0.5 + 0.3 * up + 0.7 * ridge - 0.8 * cavity);
}

// The steps of one recipe in the form `shade` reads.
export function compile(steps) {
  return steps.map(step => {
    const [r, g, b] = hexToRgb(step.color);
    return {
      key: step.key, kind: KIND[step.stage], r, g, b,
      // Later layers need more exposure: the first reaches most of the surface, the last only the top of it.
      reach: step.stage === "layers" ? 0.3 + 0.45 * (step.index - 1) / Math.max((step.of ?? step.index) - 1, 1) : 0,
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

// The colour of one point after the first `count` steps, written to out[offset..offset + 2] as sRGB bytes.
export function shade(ops, count, cavity, ridge, up, primer, out, offset) {
  let r = primer[0], g = primer[1], b = primer[2];
  const open = count > 1 ? exposure(cavity, ridge, up) : 0;
  for (let i = 0; i < count; i++) {
    const op = ops[i];
    let w;
    switch (op.kind) {
      case BASE:
        r = op.r; g = op.g; b = op.b;
        break;
      case LAYER:
        w = smooth(op.reach - 0.12, op.reach + 0.12, open);
        r += (op.r - r) * w; g += (op.g - g) * w; b += (op.b - b) * w;
        break;
      case SHADE:
        // What is underneath, darker and pulled towards the wash; a little everywhere, fully in recesses.
        w = 0.12 + 0.88 * smooth(0.08, 0.6, cavity);
        r += (0.3 * r + 0.4 * op.r - r) * w; g += (0.3 * g + 0.4 * op.g - g) * w; b += (0.3 * b + 0.4 * op.b - b) * w;
        break;
      case LINING:
        if (cavity >= op.threshold) {
          r += (op.r - r) * 0.9; g += (op.g - g) * 0.9; b += (op.b - b) * 0.9;
        }
        break;
      case HIGHLIGHT:
        w = smooth(0.45, 0.8, ridge);
        r += (op.r - r) * w; g += (op.g - g) * w; b += (op.b - b) * w;
        break;
      default:      // INK: a transparent film of the ink's colour
        r += (r * op.r / 255 - r) * 0.55; g += (g * op.g / 255 - g) * 0.55; b += (b * op.b / 255 - b) * 0.55;
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
export function buildStage({ zones, stepsByRecipe, key, stages, primer }) {
  const compiled = new Map();
  const byZone = new Map();
  for (const zone of zones) {
    const steps = zone.recipe ? stepsByRecipe[zone.recipe] : null;
    if (!steps) continue;
    if (!compiled.has(zone.recipe)) {
      const ops = compile(steps);
      compiled.set(zone.recipe, { ops, count: opsAt(ops, key, stages) });
    }
    byZone.set(zone.id, compiled.get(zone.recipe));
  }
  return { primer: hexToRgb(primer), byZone };
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
