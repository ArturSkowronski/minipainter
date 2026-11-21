import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIMER_RGB, ZoneEdit, buildPatchIndex, faceColor, facesInBrush, hexToRgb, patchRgb, zoneShares,
} from "../zonesmodel.js";

test("hex colours", () => {
  assert.deepEqual(hexToRgb("#b3202a"), [179, 32, 42]);
  assert.deepEqual(hexToRgb("#FFFFFF"), [255, 255, 255]);
});

test("patch colours are stable and differ between neighbouring ids", () => {
  assert.deepEqual(patchRgb(7), patchRgb(7));
  const distinct = new Set(Array.from({ length: 50 }, (_, i) => patchRgb(i).join(",")));
  assert.equal(distinct.size, 50);
  assert.ok(patchRgb(3).every(c => Number.isInteger(c) && c >= 0 && c <= 255));
});

test("patch index lists the faces of each patch", () => {
  const index = buildPatchIndex(Uint32Array.from([2, 0, 2, 1, 0, 2]));
  const facesOf = p => Array.from(index.faces.subarray(index.offsets[p], index.offsets[p + 1]));
  assert.deepEqual([facesOf(0), facesOf(1), facesOf(2)], [[1, 4], [3], [0, 2, 5]]);
});

// Four faces on a line along x, all facing +z, except face 3 which faces -z.
const centroids = Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 0.5, 0, 0]);
const normals = Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1]);
const brush = extra => Array.from(facesInBrush({
  centroids, normals, center: [0, 0, 0], normal: [0, 0, 1], radius: 1.2, ...extra,
}));

test("brush takes faces within its radius that face the same way", () => {
  assert.deepEqual(brush({}), [0, 1]);                     // 2 is too far, 3 faces away
  assert.deepEqual(brush({ radius: 0.4 }), [0]);
  assert.deepEqual(brush({ radius: 5 }), [0, 1, 2]);
});

test("brush can be held inside one patch", () => {
  const patches = Uint32Array.from([4, 9, 4, 4]);
  assert.deepEqual(brush({ radius: 5, patches, onlyPatch: 4 }), [0, 2]);
  assert.deepEqual(brush({ radius: 5, patches, onlyPatch: -1 }), [0, 1, 2]);
});

test("a stroke records only faces that change", () => {
  const edit = new ZoneEdit(Uint8Array.from([0, 1, 1, 0]));
  edit.begin();
  assert.deepEqual(Array.from(edit.assign([0, 1, 2], 1)), [0]);
  assert.deepEqual(Array.from(edit.assign([0, 3], 1)), [3]);
  assert.equal(edit.commit(), true);
  assert.deepEqual(Array.from(edit.zones), [1, 1, 1, 1]);
  edit.begin();
  edit.assign([0, 1], 1);
  assert.equal(edit.commit(), false);
  assert.equal(edit.canUndo, true);
});

test("undo and redo", () => {
  const edit = new ZoneEdit(Uint8Array.from([0, 2, 0]));
  edit.begin(); edit.assign([0, 1], 1); edit.commit();
  edit.begin(); edit.assign([2], 3); edit.commit();
  assert.deepEqual(Array.from(edit.undo()), [2]);
  assert.deepEqual(Array.from(edit.zones), [1, 1, 0]);
  assert.deepEqual(Array.from(edit.undo()).sort(), [0, 1]);
  assert.deepEqual(Array.from(edit.zones), [0, 2, 0]);     // face 1 goes back to zone 2, not to 0
  assert.equal(edit.undo(), null);
  assert.deepEqual(Array.from(edit.redo()).sort(), [0, 1]);
  assert.deepEqual(Array.from(edit.zones), [1, 1, 0]);
  edit.begin(); edit.assign([2], 2); edit.commit();        // a new stroke drops what could be redone
  assert.equal(edit.canRedo, false);
  assert.equal(edit.redo(), null);
});

test("history is capped at 100 strokes", () => {
  const edit = new ZoneEdit(new Uint8Array(1));
  for (let i = 0; i < 130; i++) { edit.begin(); edit.assign([0], (i % 2) + 1); edit.commit(); }
  let undone = 0;
  while (edit.undo()) undone += 1;
  assert.equal(undone, 100);
});

test("clearing a zone and replacing everything drop the history", () => {
  const edit = new ZoneEdit(Uint8Array.from([1, 2, 1]));
  edit.begin(); edit.assign([1], 1); edit.commit();
  assert.deepEqual(Array.from(edit.clearZone(1)), [0, 1, 2]);
  assert.deepEqual(Array.from(edit.zones), [0, 0, 0]);
  assert.equal(edit.canUndo, false);
  edit.begin(); edit.assign([0], 2); edit.commit();
  edit.replaceAll(Uint8Array.from([3, 3, 3]));
  assert.deepEqual(Array.from(edit.zones), [3, 3, 3]);
  assert.equal(edit.canUndo, false);
});

test("zone shares are fractions of the part's area", () => {
  const shares = zoneShares(Uint8Array.from([0, 1, 1, 2]), Float32Array.from([1, 2, 3, 4]));
  assert.deepEqual([shares.get(0), shares.get(1), shares.get(2)], [0.1, 0.5, 0.4]);
});

test("face colours per view mode", () => {
  const data = {
    zones: Uint8Array.from([0, 2]), zoneRgb: new Map([[2, [10, 20, 30]]]),
    patches: Uint32Array.from([5, 6]), cavity: Uint8Array.from([255, 0]), ridge: Uint8Array.from([0, 255]),
  };
  assert.deepEqual(faceColor("zones", 0, data), PRIMER_RGB);
  assert.deepEqual(faceColor("zones", 1, data), [10, 20, 30]);
  assert.deepEqual(faceColor("patches", 1, data), patchRgb(6));
  const [cavity, ridge] = [faceColor("relief", 0, data), faceColor("relief", 1, data)];
  assert.ok(cavity[2] > cavity[0] && ridge[0] > ridge[2]);   // recess reads blue, bump reads orange
});
