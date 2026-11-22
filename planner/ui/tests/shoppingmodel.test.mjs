import assert from "node:assert/strict";
import test from "node:test";

import { gapReason, nearness, shoppingText, stepsText } from "../shoppingmodel.js";

const paint = (name, provider = "citadel", format = "opaque_layer") => ({ id: name, name, provider, format, hex: "#102030" });

test("steps are named the way the plan names them, layers as a range", () => {
  assert.equal(stepsText(["base"]), "baza");
  assert.equal(stepsText(["base", "layer:1", "layer:2", "highlight"]), "baza, warstwy 1–2, rozjaśnienie");
  assert.equal(stepsText(["layer:2"]), "warstwa 2");
  assert.equal(stepsText(["layer:1", "layer:3", "layer:4", "layer:5", "shade"]), "warstwy 1, 3–5, cień");
  assert.equal(stepsText(["lining", "ink"]), "linie, tusz");
  assert.equal(stepsText([]), "");
});

test("how near a proposal is, in words", () => {
  assert.equal(nearness(0.004), "prawie ten sam kolor");
  assert.equal(nearness(0.03), "bardzo blisko");
  assert.equal(nearness(0.07), "blisko");
  assert.equal(nearness(0.2), "najbliższa w katalogu, wyraźnie inna");
});

test("why a step is on the list", () => {
  const have = paint("Ducat Blue");
  assert.equal(gapReason({ reason: "none", stage: "base", have: null }), "nie masz farby na ten krok");
  assert.equal(gapReason({ reason: "far", grade: "missing", stage: "base", have }), "masz Ducat Blue, ale to inny kolor");
  assert.equal(gapReason({ reason: "far", grade: "better", stage: "base", have }), "masz Ducat Blue — zbliżona, ale nie ten kolor");
  assert.equal(gapReason({ reason: "flat", grade: "missing", stage: "highlight", have }),
    "nie masz nic jaśniejszego niż baza (Ducat Blue), więc warstwy nie mają czym rozjaśniać");
  assert.equal(gapReason({ reason: "mix", grade: "better", stage: "layers", have: null }), "teraz mieszanka; gotowa farba ją zastąpi");
  assert.match(gapReason({ reason: "flat", grade: "missing", stage: "highlight", have, off: true }), /etap rozjaśnienia jest wyłączony/);
});

test("the list as text to take to the shop", () => {
  const answer = {
    recipes: [{ id: "r1", name: "Czerwień" }, { id: "r2", name: "Błękit" }],
    buy: [
      { paint: paint("Calgar Blue"), grade: "missing", for: [{ recipe: "r2", keys: ["base", "layer:1", "layer:2"] }] },
      { paint: paint("Baron Blue", "army_painter"), grade: "missing",
        for: [{ recipe: "r2", keys: ["highlight"] }, { recipe: "r1", keys: ["layer:1"] }] },
      { paint: paint("Blood Red", "ak_interactive", "opaque_base"), grade: "better", for: [{ recipe: "r1", keys: ["base"] }] },
    ],
  };
  assert.equal(shoppingText(answer), [
    "Brakuje:",
    "- Calgar Blue (Citadel, layer) — Błękit: baza, warstwy 1–2",
    "- Baron Blue (Army Painter, layer) — Błękit: rozjaśnienie; Czerwień: warstwa 1",
    "Warto dokupić:",
    "- Blood Red (AK Interactive, base) — Czerwień: baza",
  ].join("\n"));
  assert.equal(shoppingText({ recipes: [], buy: [] }), "");
});
