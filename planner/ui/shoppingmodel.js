// The shopping list in words, without the DOM. Tested with node.
import { FORMAT_LABEL, STAGE_LABEL } from "./stagemodel.js";

export const PROVIDER_LABEL = {
  citadel: "Citadel", army_painter: "Army Painter", vallejo: "Vallejo", ak_interactive: "AK Interactive",
};

export const GRADE_LABEL = { missing: "Brakuje", better: "Warto dokupić" };

export const describePaint = paint =>
  `${PROVIDER_LABEL[paint.provider] ?? paint.provider}, ${FORMAT_LABEL[paint.format] ?? paint.format}`;

// ["base", "layer:1", "layer:2", "highlight"] -> "baza, warstwy 1–2, rozjaśnienie"
export function stepsText(keys) {
  const layers = keys.filter(key => key.startsWith("layer:")).map(key => Number(key.slice(6))).sort((a, b) => a - b);
  const runs = [];
  for (const layer of layers) {
    const run = runs.at(-1);
    if (run && run[1] === layer - 1) run[1] = layer;
    else runs.push([layer, layer]);
  }
  const layersText = `${layers.length > 1 ? "warstwy" : "warstwa"} ${runs.map(([from, to]) => (from === to ? from : `${from}–${to}`)).join(", ")}`;
  const words = [];
  for (const key of keys) {
    if (!key.startsWith("layer:")) words.push(STAGE_LABEL[key].toLowerCase());
    else if (!words.includes(layersText)) words.push(layersText);
  }
  return words.join(", ");
}

// How near a proposed paint is to the colour wanted (an OKLab distance; 0.04 is where a bottle passes for it).
export function nearness(distance) {
  if (distance < 0.02) return "prawie ten sam kolor";
  if (distance < 0.04) return "bardzo blisko";
  if (distance < 0.08) return "blisko";
  return "najbliższa w katalogu, wyraźnie inna";
}

// Why a step of a recipe is on the list.
export function gapReason(gap) {
  const off = gap.off ? " (etap rozjaśnienia jest wyłączony, ale warstwy rozjaśniają w stronę tego koloru)" : "";
  if (gap.reason === "none") return `nie masz farby na ten krok${off}`;
  if (gap.reason === "flat") return `nie masz nic jaśniejszego niż baza (${gap.have.name}), więc warstwy nie mają czym rozjaśniać${off}`;
  if (gap.reason === "mix") return "teraz mieszanka; gotowa farba ją zastąpi";
  return (gap.grade === "missing" ? `masz ${gap.have.name}, ale to inny kolor` : `masz ${gap.have.name} — zbliżona, ale nie ten kolor`) + off;
}

// What a bought paint is then used for: "Błękit: baza, warstwy 1–2; Czerwień: warstwa 1".
export function servesText(entry, recipes) {
  const name = id => recipes.find(recipe => recipe.id === id)?.name ?? id;
  return entry.for.map(use => `${name(use.recipe)}: ${stepsText(use.keys)}`).join("; ");
}

// The list as plain text, to copy.
export function shoppingText({ recipes, buy }) {
  const lines = [];
  for (const grade of ["missing", "better"]) {
    const entries = buy.filter(entry => entry.grade === grade);
    if (!entries.length) continue;
    lines.push(`${GRADE_LABEL[grade]}:`);
    for (const entry of entries) {
      const serves = servesText(entry, recipes);
      lines.push(`- ${entry.paint.name} (${describePaint(entry.paint)})${serves ? ` — ${serves}` : ""}`);
    }
  }
  return lines.join("\n");
}
