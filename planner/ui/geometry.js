// Loads part meshes. Geometries are kept for the lifetime of the page: switching part or mode never refetches.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
const geometries = new Map();  // url -> Promise<BufferGeometry> (indexed, with smooth normals and bounds)

export function loadGeometry(url) {
  if (!geometries.has(url)) {
    geometries.set(url, loader.loadAsync(url).then(gltf => {
      let geometry = null;
      gltf.scene.traverse(object => { if (object.isMesh && !geometry) geometry = object.geometry; });
      geometry.computeVertexNormals();     // the files carry positions only
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      return geometry;
    }).catch(error => {
      geometries.delete(url);              // let a later attempt retry
      throw error;
    }));
  }
  return geometries.get(url);
}

export async function fetchArray(url, Type) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Nie udało się wczytać ${url} (${response.status}).`);
  return new Type(await response.arrayBuffer());
}
