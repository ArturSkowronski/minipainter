// The 3D stage: one part on its own, or all parts assembled. Meshes stay at their file coordinates in
// both modes, so a part shown alone sits where it sits in the figure.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const PRIMER = 0x8b8e93;       // primer grey: the colour an unpainted part has on the desk
const DIMMED = 0x55585e;       // unselected parts in the assembled figure
const FOV = 35;
const MARGIN = 1.15;
const DEFAULT_DIRECTION = new THREE.Vector3(0.55, 0.3, 1).normalize();
const STAT_FRAMES = 120;

const loader = new GLTFLoader();
const geometries = new Map();  // url -> Promise<BufferGeometry>, kept for the lifetime of the page

function loadGeometry(url) {
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

export function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 5000);
  camera.position.copy(DEFAULT_DIRECTION).multiplyScalar(300);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(0.4, 0.9, 1);      // rides with the camera: the lit side always faces the viewer
  camera.add(keyLight);
  scene.add(camera, new THREE.HemisphereLight(0xffffff, 0x30333a, 1.0));
  const group = new THREE.Group();
  scene.add(group);

  const primer = new THREE.MeshStandardMaterial({ color: PRIMER, roughness: 0.85, metalness: 0 });
  const dimmed = new THREE.MeshStandardMaterial({ color: DIMMED, roughness: 0.85, metalness: 0 });
  const chosen = new THREE.MeshStandardMaterial({
    color: PRIMER, roughness: 0.85, metalness: 0, emissiveIntensity: 0.22,
  });

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.addEventListener("change", requestRender);

  const meshes = new Map();    // part id -> Mesh
  let mode = null;             // "part" | "assembled"
  let selected = null;
  let generation = 0;          // bumped whenever the scene is replaced; stale loads check it
  let framedRadius = 0;
  let pick = () => {};

  // -- theme ------------------------------------------------------------------------------------

  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  function applyTheme() {
    const style = getComputedStyle(canvas.parentElement ?? document.documentElement);
    scene.background = new THREE.Color(style.getPropertyValue("--stage").trim() || "#dfe1e5");
    chosen.emissive = new THREE.Color(style.getPropertyValue("--accent").trim() || "#2f5bd0");
    requestRender();
  }
  scheme.addEventListener("change", applyTheme);

  // -- rendering on demand ----------------------------------------------------------------------

  let scheduled = false;
  let lastFrame = 0;
  const intervals = [];

  function requestRender() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(draw);
  }

  function draw(now) {
    scheduled = false;
    if (now - lastFrame < 100) {            // only back-to-back frames say anything about frame time
      intervals.push(now - lastFrame);
      if (intervals.length > STAT_FRAMES) intervals.shift();
    }
    lastFrame = now;
    controls.update();                      // damping: fires "change" again while the view still moves
    renderer.render(scene, camera);
  }

  const resizer = new ResizeObserver(() => {
    const box = canvas.parentElement.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    renderer.setSize(box.width, box.height, false);
    camera.aspect = box.width / box.height;
    camera.updateProjectionMatrix();
    requestRender();
  });
  resizer.observe(canvas.parentElement);

  // -- scene ------------------------------------------------------------------------------------

  function materialFor(id) {
    if (mode !== "assembled" || selected === null) return primer;
    return id === selected ? chosen : dimmed;
  }

  function restyle() {
    for (const [id, mesh] of meshes) mesh.material = materialFor(id);
    requestRender();
  }

  function remove(id) {
    group.remove(meshes.get(id));
    meshes.delete(id);
  }

  function clear() {
    generation += 1;
    for (const id of [...meshes.keys()]) remove(id);
    framedRadius = 0;
    mode = null;
    requestRender();
  }

  function add(id, url, geometry) {
    const mesh = new THREE.Mesh(geometry, materialFor(id));
    mesh.userData = { id, url };
    meshes.set(id, mesh);
    group.add(mesh);
  }

  // Frame what is shown. Unless forced, only when the figure has grown noticeably since the last framing.
  function frame(force) {
    if (meshes.size === 0) return;
    const box = new THREE.Box3();
    for (const mesh of meshes.values()) box.union(mesh.geometry.boundingBox);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!force && framedRadius > 0 && sphere.radius <= framedRadius * 1.1) return;
    framedRadius = sphere.radius;

    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 1e-9) direction.copy(DEFAULT_DIRECTION);
    direction.normalize();
    const vertical = THREE.MathUtils.degToRad(FOV) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = (sphere.radius * MARGIN) / Math.sin(Math.min(vertical, horizontal));
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(direction, distance);
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    controls.update();
    requestRender();
  }

  async function showPart(part) {
    clear();
    mode = "part";
    const mine = generation;
    const geometry = await loadGeometry(part.url);
    if (mine !== generation) return;        // something else was shown while this loaded
    add(part.id, part.url, geometry);
    frame(true);
  }

  async function showAssembled(parts, selectedId) {
    if (mode !== "assembled") {
      clear();
      mode = "assembled";
    }
    selected = selectedId;
    const wanted = new Map(parts.map(part => [part.id, part.url]));
    for (const [id, mesh] of [...meshes]) {
      if (wanted.get(id) !== mesh.userData.url) remove(id);
    }
    if (meshes.size === 0) framedRadius = 0;
    restyle();
    const mine = generation;
    await Promise.all(parts.filter(part => !meshes.has(part.id)).map(async part => {
      const geometry = await loadGeometry(part.url);
      if (mine !== generation || meshes.has(part.id)) return;
      add(part.id, part.url, geometry);     // the figure appears piece by piece
      frame(false);
    }));
  }

  function setSelected(id) {
    selected = id;
    restyle();
  }

  // -- picking ----------------------------------------------------------------------------------

  const raycaster = new THREE.Raycaster();
  let down = null;
  function onPointerDown(event) { down = { x: event.clientX, y: event.clientY }; }
  function onPointerUp(event) {
    const start = down;
    down = null;
    if (!start || mode !== "assembled") return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4) return;   // that was a drag
    const box = canvas.getBoundingClientRect();
    const point = new THREE.Vector2(
      ((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(point, camera);
    const hit = raycaster.intersectObjects(group.children, false)[0];
    if (hit) pick(hit.object.userData.id);
  }
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);

  // -- measurements -----------------------------------------------------------------------------

  function stats() {
    const frameMs = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
    return { triangles: renderer.info.render.triangles, frameMs: Math.round(frameMs * 10) / 10 };
  }

  // Orbit for a fixed number of frames and report; used to check the performance budget.
  function benchmark(frames = STAT_FRAMES) {
    intervals.length = 0;
    return new Promise(resolve => {
      let left = frames;
      const axis = new THREE.Vector3(0, 1, 0);
      (function step() {
        camera.position.sub(controls.target).applyAxisAngle(axis, 0.03).add(controls.target);
        requestRender();
        left -= 1;
        if (left > 0) requestAnimationFrame(step);
        else requestAnimationFrame(() => resolve(stats()));
      })();
    });
  }

  window.__viewerStats = stats;
  window.__viewerBenchmark = benchmark;
  applyTheme();

  return {
    showPart,
    showAssembled,
    setSelected,
    clear,
    onPick(callback) { pick = callback; },
    stats,
    dispose() {
      generation += 1;
      resizer.disconnect();
      scheme.removeEventListener("change", applyTheme);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      for (const material of [primer, dimmed, chosen]) material.dispose();
      renderer.dispose();
      delete window.__viewerStats;
      delete window.__viewerBenchmark;
    },
  };
}
