import assert from "node:assert/strict";
import test from "node:test";

import {
  KIND_LABEL, STATUS_LABEL, activeVariant, assembledParts, firstViewablePart, progress, routeFromHash,
} from "../model.js";

const plan = { active_variant: "split", variants: [
  { id: "split", kind: "split", parts: [
    { id: "a", status: "ready", outlier: false }, { id: "b", status: "processing", outlier: false },
    { id: "c", status: "error", outlier: false }, { id: "d", status: "ready", outlier: true }] },
  { id: "bust", kind: "bust", parts: [] }] };

test("route", () => {
  assert.deepEqual(routeFromHash("#p/spidey-1a2b3c4d"), { screen: "project", slug: "spidey-1a2b3c4d" });
  assert.deepEqual(routeFromHash(""), { screen: "start" });
  assert.deepEqual(routeFromHash("#p/"), { screen: "start" });
});
test("active variant", () => {
  assert.equal(activeVariant(plan).id, "split");
  assert.equal(activeVariant({ active_variant: null, variants: [] }), null);
});
test("progress counts ready, total and failed", () => {
  assert.deepEqual(progress(plan.variants[0]), { ready: 2, total: 4, failed: 1 });
});
test("assembled view leaves out unfinished parts and outliers", () => {
  assert.deepEqual(assembledParts(plan.variants[0]).map(p => p.id), ["a"]);
});
test("first viewable part", () => {
  assert.equal(firstViewablePart(plan.variants[0]).id, "a");
  assert.equal(firstViewablePart(plan.variants[1]), null);
});
test("labels are Polish", () => {
  assert.equal(STATUS_LABEL.processing, "przetwarzanie…");
  assert.equal(KIND_LABEL.bust, "popiersie");
});
