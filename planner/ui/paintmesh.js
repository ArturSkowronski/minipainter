// The paintable form of one part: every face has its own three vertices, so a face can carry its own
// colour and its own id. Built from the frozen preview mesh and its sidecar files.
import * as THREE from "three";

import { fetchArray, loadGeometry } from "./geometry.js";
import { PRIMER_RGB, buildPatchIndex, faceColor, queueFaceUpload } from "./zonesmodel.js";

export async function loadPaintMesh({ meshUrl, patchesUrl, masksUrl }) {
  const [indexed, patches, vertexMasks] = await Promise.all([
    loadGeometry(meshUrl), fetchArray(patchesUrl, Uint32Array), fetchArray(masksUrl, Uint8Array),
  ]);
  const index = indexed.index.array;
  const source = indexed.attributes.position.array;
  const sourceNormal = indexed.attributes.normal.array;
  const faceCount = index.length / 3;
  if (patches.length !== faceCount) throw new Error("Płaty nie pasują do siatki.");

  const position = new Float32Array(faceCount * 9);
  const normal = new Float32Array(faceCount * 9);
  const color = new Uint8Array(faceCount * 9);
  const faceId = new Uint8Array(faceCount * 9);
  const centroids = new Float32Array(faceCount * 3);
  const faceNormals = new Float32Array(faceCount * 3);
  const areas = new Float32Array(faceCount);
  const cavity = new Uint8Array(faceCount);
  const ridge = new Uint8Array(faceCount);

  for (let face = 0; face < faceCount; face++) {
    const id = face + 1;                                   // 0 is "nothing here"
    let cavitySum = 0, ridgeSum = 0;
    for (let corner = 0; corner < 3; corner++) {
      const vertex = index[face * 3 + corner];
      const out = face * 9 + corner * 3;
      for (let k = 0; k < 3; k++) {
        position[out + k] = source[vertex * 3 + k];
        normal[out + k] = sourceNormal[vertex * 3 + k];
        centroids[face * 3 + k] += source[vertex * 3 + k] / 3;
        color[out + k] = PRIMER_RGB[k];
      }
      faceId[out] = id & 255;
      faceId[out + 1] = (id >> 8) & 255;
      faceId[out + 2] = (id >> 16) & 255;
      cavitySum += vertexMasks[vertex * 2];
      ridgeSum += vertexMasks[vertex * 2 + 1];
    }
    cavity[face] = Math.round(cavitySum / 3);
    ridge[face] = Math.round(ridgeSum / 3);
    const p = face * 9;
    const ux = position[p + 3] - position[p], uy = position[p + 4] - position[p + 1], uz = position[p + 5] - position[p + 2];
    const vx = position[p + 6] - position[p], vy = position[p + 7] - position[p + 1], vz = position[p + 8] - position[p + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    faceNormals[face * 3] = nx / length;
    faceNormals[face * 3 + 1] = ny / length;
    faceNormals[face * 3 + 2] = nz / length;
    areas[face] = length / 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  const colorAttribute = new THREE.BufferAttribute(color, 3, true);
  colorAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("color", colorAttribute);
  geometry.setAttribute("faceId", new THREE.BufferAttribute(faceId, 3, true));
  geometry.boundingBox = indexed.boundingBox.clone();
  geometry.boundingSphere = indexed.boundingSphere.clone();

  return {
    geometry, faceCount, centroids, faceNormals, areas, patches, cavity, ridge,
    patchIndex: buildPatchIndex(patches),

    // Rewrite the colour of the given faces (or of all, with null) and upload only the touched range.
    recolor(faces, mode, zones, zoneRgb) {
      const data = { zones, zoneRgb, patches: this.patches, cavity, ridge };
      let first = 0, last = faceCount - 1;
      const paint = face => {
        const rgb = faceColor(mode, face, data);
        for (let i = face * 9; i < face * 9 + 9; i += 3) {
          color[i] = rgb[0]; color[i + 1] = rgb[1]; color[i + 2] = rgb[2];
        }
      };
      if (faces === null) {
        for (let face = 0; face < faceCount; face++) paint(face);
      } else {
        if (faces.length === 0) return;
        first = faceCount; last = 0;
        for (const face of faces) {
          paint(face);
          if (face < first) first = face;
          if (face > last) last = face;
        }
      }
      queueFaceUpload(colorAttribute, first, last);
    },

    // After the patches were cut again.
    setPatches(next) {
      this.patches = next;
      this.patchIndex = buildPatchIndex(next);
    },

    dispose() { geometry.dispose(); },
  };
}

// Colours for the lighter assembled-view mesh: each of its faces takes the zone of the preview face it maps to.
export function lodFaceColors(lodmap, zones, zoneRgb) {
  const rgb = new Uint8Array(lodmap.length * 3);
  for (let face = 0; face < lodmap.length; face++) {
    const [r, g, b] = zoneRgb.get(zones[lodmap[face]]) ?? PRIMER_RGB;
    rgb[face * 3] = r; rgb[face * 3 + 1] = g; rgb[face * 3 + 2] = b;
  }
  return rgb;
}
