// Zone editing without the DOM or three.js: colours, the brush's reach, strokes and undo. Tested with node.

export const PRIMER_RGB = [139, 142, 147];
const HISTORY = 100;

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// A well-spread colour per patch id: the golden angle walks the hue circle, lightness alternates.
export function patchRgb(id) {
  const hue = (id * 137.508) % 360;
  const light = 0.42 + 0.12 * (id % 3);
  const chroma = (1 - Math.abs(2 * light - 1)) * 0.6;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - chroma / 2;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x]
    : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return [r, g, b].map(c => Math.round((c + m) * 255));
}

// faces.subarray(offsets[p], offsets[p + 1]) are the faces of patch p.
export function buildPatchIndex(patches) {
  let count = 0;
  for (let i = 0; i < patches.length; i++) if (patches[i] >= count) count = patches[i] + 1;
  const offsets = new Uint32Array(count + 1);
  for (let i = 0; i < patches.length; i++) offsets[patches[i] + 1] += 1;
  for (let p = 0; p < count; p++) offsets[p + 1] += offsets[p];
  const next = offsets.slice(0, count);
  const faces = new Uint32Array(patches.length);
  for (let i = 0; i < patches.length; i++) faces[next[patches[i]]++] = i;
  return { offsets, faces };
}

// Faces whose centroid lies inside the brush sphere and that face the same way as the surface under the
// pointer — which keeps the brush off the far side of thin geometry.
export function facesInBrush({ centroids, normals, center, normal, radius, patches = null, onlyPatch = -1 }) {
  const [cx, cy, cz] = center;
  const [nx, ny, nz] = normal;
  const limit = radius * radius;
  const hit = [];
  for (let f = 0, i = 0; i < centroids.length; f++, i += 3) {
    const dx = centroids[i] - cx, dy = centroids[i + 1] - cy, dz = centroids[i + 2] - cz;
    if (dx * dx + dy * dy + dz * dz > limit) continue;
    if (normals[i] * nx + normals[i + 1] * ny + normals[i + 2] * nz <= 0) continue;
    if (onlyPatch >= 0 && patches[f] !== onlyPatch) continue;
    hit.push(f);
  }
  return Uint32Array.from(hit);
}

// The zone of every face, with strokes that can be undone. `zones` is edited in place.
export class ZoneEdit {
  constructor(zones) {
    this.zones = zones;
    this.done = [];
    this.undone = [];
    this.open = null;
  }

  get canUndo() { return this.done.length > 0; }
  get canRedo() { return this.undone.length > 0; }

  begin() {
    if (!this.open) this.open = { faces: [], before: [], zone: 0 };
  }

  // Put faces into a zone. Returns the faces that actually changed.
  assign(faces, zoneId) {
    const changed = [];
    for (const face of faces) {
      if (this.zones[face] === zoneId) continue;
      if (this.open) {
        this.open.faces.push(face);
        this.open.before.push(this.zones[face]);
        this.open.zone = zoneId;
      }
      this.zones[face] = zoneId;
      changed.push(face);
    }
    return Uint32Array.from(changed);
  }

  // Close the stroke. False when it changed nothing (and then nothing is recorded).
  commit() {
    const stroke = this.open;
    this.open = null;
    if (!stroke || stroke.faces.length === 0) return false;
    this.done.push({
      faces: Uint32Array.from(stroke.faces), before: Uint8Array.from(stroke.before), zone: stroke.zone,
    });
    if (this.done.length > HISTORY) this.done.shift();
    this.undone.length = 0;
    return true;
  }

  undo() {
    const stroke = this.done.pop();
    if (!stroke) return null;
    for (let i = stroke.faces.length - 1; i >= 0; i--) this.zones[stroke.faces[i]] = stroke.before[i];
    this.undone.push(stroke);
    return stroke.faces;
  }

  redo() {
    const stroke = this.undone.pop();
    if (!stroke) return null;
    for (const face of stroke.faces) this.zones[face] = stroke.zone;
    this.done.push(stroke);
    return stroke.faces;
  }

  forget() {
    this.done.length = 0;
    this.undone.length = 0;
    this.open = null;
  }

  // The zone was deleted: its faces go back to no zone. History could bring the id back, so it goes too.
  clearZone(zoneId) {
    const changed = [];
    for (let face = 0; face < this.zones.length; face++) {
      if (this.zones[face] === zoneId) { this.zones[face] = 0; changed.push(face); }
    }
    this.forget();
    return Uint32Array.from(changed);
  }

  replaceAll(zones) {
    this.zones = zones;
    this.forget();
  }
}

// Fraction of the part's area per zone id (0 = no zone).
export function zoneShares(zones, areas) {
  const sums = new Map();
  let total = 0;
  for (let face = 0; face < zones.length; face++) {
    sums.set(zones[face], (sums.get(zones[face]) ?? 0) + areas[face]);
    total += areas[face];
  }
  for (const [zone, area] of sums) sums.set(zone, Math.round((area / total) * 1e6) / 1e6);
  return sums;
}

const RELIEF_BASE = [150, 150, 150], RELIEF_CAVITY = [50, 80, 210], RELIEF_RIDGE = [245, 150, 50];

// The colour of one face in a view mode: "zones", "patches" or "relief".
export function faceColor(mode, face, { zones, zoneRgb, patches, cavity, ridge }) {
  if (mode === "patches") return patchRgb(patches[face]);
  if (mode === "relief") {
    const c = cavity[face] / 255, r = ridge[face] / 255;
    return RELIEF_BASE.map((base, k) => Math.round(base + (RELIEF_CAVITY[k] - base) * c + (RELIEF_RIDGE[k] - base) * r));
  }
  return zoneRgb.get(zones[face]) ?? PRIMER_RGB;
}
