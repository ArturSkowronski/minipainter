// The 3D stage: one part on its own (paintable when it has been analysed), or all parts assembled.
// Meshes stay at their file coordinates in every mode, so a part shown alone sits where it sits in the figure.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { loadGeometry } from "./geometry.js";
import { PRIMER_RGB, facesInBrush } from "./zonesmodel.js";

const PRIMER = 0x8b8e93;       // primer grey: the colour an unpainted part has on the desk
const FOV = 35;
const MARGIN = 1.15;
const DEFAULT_DIRECTION = new THREE.Vector3(0.55, 0.3, 1).normalize();
const STAT_FRAMES = 120;
const SURFACE = { roughness: 0.85, metalness: 0 };

const assembledGeometries = new Map();   // url -> Promise<BufferGeometry>, one vertex set per face, coloured

function loadAssembledGeometry(url) {
  if (!assembledGeometries.has(url)) {
    assembledGeometries.set(url, loadGeometry(url).then(indexed => {
      const geometry = indexed.toNonIndexed();
      const color = new Uint8Array(geometry.attributes.position.count * 3);
      for (let i = 0; i < color.length; i += 3) color.set(PRIMER_RGB, i);
      geometry.setAttribute("color", new THREE.BufferAttribute(color, 3, true));
      geometry.boundingBox = indexed.boundingBox.clone();
      geometry.boundingSphere = indexed.boundingSphere.clone();
      return geometry;
    }).catch(error => {
      assembledGeometries.delete(url);
      throw error;
    }));
  }
  return assembledGeometries.get(url);
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

  const primer = new THREE.MeshStandardMaterial({ color: PRIMER, ...SURFACE });
  // Vertex colours carry the paint; the material colour only dims or keeps them.
  const painted = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, ...SURFACE });
  const dimmed = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, vertexColors: true, ...SURFACE });
  const chosen = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, emissiveIntensity: 0.22, ...SURFACE,
  });

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.addEventListener("change", () => { idStale = true; requestRender(); });

  const meshes = new Map();    // part id -> Mesh
  let mode = null;             // "part" | "paint" | "assembled"
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
    idStale = true;
    requestRender();
  });
  resizer.observe(canvas.parentElement);

  // -- scene ------------------------------------------------------------------------------------

  function materialFor(id) {
    if (mode === "paint") return painted;
    if (mode !== "assembled") return primer;
    if (selected === null) return painted;
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
    paint = null;
    idMesh.visible = false;
    ring.visible = false;
    endStroke();
    requestRender();
  }

  function add(id, url, geometry) {
    const mesh = new THREE.Mesh(geometry, materialFor(id));
    mesh.userData = { id, url, colorKey: null };
    meshes.set(id, mesh);
    group.add(mesh);
    return mesh;
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
    idStale = true;
    requestRender();
  }

  // A part without analysis yet: plain primer, not paintable.
  async function showPart(part) {
    clear();
    mode = "part";
    const mine = generation;
    const geometry = await loadGeometry(part.url);
    if (mine !== generation) return;        // something else was shown while this loaded
    add(part.id, part.url, geometry);
    frame(true);
  }

  // -- painting ---------------------------------------------------------------------------------

  let paint = null;            // { mesh: PaintMesh, view, zones, zoneRgb }
  let tool = { tool: "orbit", radius: 2, stayInPatch: false };
  let onStroke = () => {};
  let stroke = null;           // { patch, patchesDone }

  // Faces drawn in the colour of their id, never shown: reading a pixel tells which face is under the pointer.
  const idScene = new THREE.Scene();
  const idMaterial = new THREE.ShaderMaterial({
    vertexShader: "attribute vec3 faceId; varying vec3 vId; void main() { vId = faceId; "
      + "gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "varying vec3 vId; void main() { gl_FragColor = vec4(vId, 1.0); }",
  });
  const idMesh = new THREE.Mesh(new THREE.BufferGeometry(), idMaterial);
  idMesh.visible = false;
  idMesh.frustumCulled = false;
  idScene.add(idMesh);
  const idTarget = new THREE.WebGLRenderTarget(1, 1);
  const idPixel = new Uint8Array(4);
  let idStale = true;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.93, 1, 64),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
  ring.renderOrder = 10;
  ring.visible = false;
  scene.add(ring);

  function showPaint(paintMesh, { view, zones, zoneRgb }) {
    clear();
    mode = "paint";
    paint = { mesh: paintMesh, view, zones, zoneRgb };
    paintMesh.recolor(null, view, zones, zoneRgb);
    add("paint", null, paintMesh.geometry);
    idMesh.geometry = paintMesh.geometry;
    idMesh.visible = true;
    idStale = true;
    frame(true);
  }

  // New zone array, zone colours or view mode: repaint everything.
  function setPaintData(changes) {
    if (!paint) return;
    Object.assign(paint, changes);
    refreshColors(null);
  }

  function refreshColors(faces) {
    if (!paint) return;
    paint.mesh.recolor(faces, paint.view, paint.zones, paint.zoneRgb);
    requestRender();
  }

  function setTool(next) {
    tool = { ...tool, ...next };
    ring.visible = false;
    canvas.style.cursor = tool.tool === "orbit" || mode !== "paint" ? "" : "crosshair";
    requestRender();
  }

  // The face under a point of the window, or -1.
  function pickFace(clientX, clientY) {
    if (mode !== "paint") return -1;
    const box = canvas.getBoundingClientRect();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (idTarget.width !== size.x || idTarget.height !== size.y) {
      idTarget.setSize(size.x, size.y);
      idStale = true;
    }
    if (idStale) {
      const previous = renderer.getClearColor(new THREE.Color());
      const alpha = renderer.getClearAlpha();
      renderer.setRenderTarget(idTarget);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(idScene, camera);
      renderer.setRenderTarget(null);
      renderer.setClearColor(previous, alpha);
      idStale = false;
    }
    const x = Math.floor(((clientX - box.left) / box.width) * size.x);
    const y = Math.floor((1 - (clientY - box.top) / box.height) * size.y);
    if (x < 0 || y < 0 || x >= size.x || y >= size.y) return -1;
    renderer.readRenderTargetPixels(idTarget, x, y, 1, 1, idPixel);
    return (idPixel[0] | (idPixel[1] << 8) | (idPixel[2] << 16)) - 1;
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // Where the pointer's ray meets the plane of a face, and that face's normal.
  function surfacePoint(face, clientX, clientY) {
    const box = canvas.getBoundingClientRect();
    pointer.set(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const { centroids, faceNormals } = paint.mesh;
    const normal = new THREE.Vector3(faceNormals[face * 3], faceNormals[face * 3 + 1], faceNormals[face * 3 + 2]);
    const centre = new THREE.Vector3(centroids[face * 3], centroids[face * 3 + 1], centroids[face * 3 + 2]);
    const { origin, direction } = raycaster.ray;
    const along = direction.dot(normal);
    const distance = Math.abs(along) < 1e-6 ? origin.distanceTo(centre) : centre.clone().sub(origin).dot(normal) / along;
    return { point: origin.clone().addScaledVector(direction, distance), normal };
  }

  function moveRing(point, normal) {
    ring.position.copy(point).addScaledVector(normal, tool.radius * 0.02);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    ring.scale.setScalar(tool.radius);
    ring.visible = true;
    requestRender();
  }

  // The faces the active tool reaches from one pointer position.
  function reach(clientX, clientY) {
    const face = pickFace(clientX, clientY);
    if (face < 0) { ring.visible = false; requestRender(); return null; }
    const patch = paint.mesh.patches[face];
    if (tool.tool === "patch") {
      const { offsets, faces } = paint.mesh.patchIndex;
      return { face, patch, faces: faces.subarray(offsets[patch], offsets[patch + 1]) };
    }
    const { point, normal } = surfacePoint(face, clientX, clientY);
    moveRing(point, normal);
    return {
      face, patch,
      faces: facesInBrush({
        centroids: paint.mesh.centroids, normals: paint.mesh.faceNormals,
        center: point.toArray(), normal: normal.toArray(), radius: tool.radius,
        patches: paint.mesh.patches, onlyPatch: tool.stayInPatch && stroke ? stroke.patch : -1,
      }),
    };
  }

  function dab(clientX, clientY) {
    const hit = reach(clientX, clientY);
    if (!hit) return;
    if (tool.tool === "patch") {
      if (stroke.patchesDone.has(hit.patch)) return;
      stroke.patchesDone.add(hit.patch);
    }
    if (hit.faces.length) onStroke({ phase: "paint", faces: hit.faces, patch: hit.patch });
  }

  function endStroke() {
    if (!stroke) return;
    stroke = null;
    controls.enabled = true;
    onStroke({ phase: "end", faces: new Uint32Array(0), patch: -1 });
  }

  // Registered in the capture phase, so they run before the orbit controls see the event.
  function onPaintDown(event) {
    if (mode !== "paint" || tool.tool === "orbit" || event.button !== 0) return;
    const face = pickFace(event.clientX, event.clientY);
    if (face < 0) return;                    // a press on the background orbits as usual
    controls.enabled = false;
    stroke = { patch: paint.mesh.patches[face], patchesDone: new Set() };
    try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic events have no pointer */ }
    onStroke({ phase: "begin", faces: new Uint32Array(0), patch: stroke.patch });
    dab(event.clientX, event.clientY);
  }

  function onPaintMove(event) {
    if (mode !== "paint" || tool.tool === "orbit") return;
    if (!stroke) {
      if (tool.tool !== "patch" && event.buttons === 0) reach(event.clientX, event.clientY);
      return;
    }
    const steps = event.getCoalescedEvents?.() ?? [];
    for (const step of steps.length ? steps : [event]) dab(step.clientX, step.clientY);
  }

  function onPaintUp() { endStroke(); }
  function onPaintLeave() { if (!stroke) { ring.visible = false; requestRender(); } }

  canvas.addEventListener("pointerdown", onPaintDown, { capture: true });
  canvas.addEventListener("pointermove", onPaintMove, { capture: true });
  canvas.addEventListener("pointerup", onPaintUp, { capture: true });
  canvas.addEventListener("pointercancel", onPaintUp, { capture: true });
  canvas.addEventListener("pointerleave", onPaintLeave);

  // -- assembled figure -------------------------------------------------------------------------

  function colour(mesh, part) {
    if (mesh.userData.colorKey === (part.colorKey ?? null)) return;
    mesh.userData.colorKey = part.colorKey ?? null;
    const attribute = mesh.geometry.attributes.color;
    const target = attribute.array;
    for (let face = 0, i = 0; i < target.length; face++, i += 9) {
      const from = part.faceRgb ? face * 3 : -1;
      for (let corner = 0; corner < 9; corner += 3) {
        target[i + corner] = from < 0 ? PRIMER_RGB[0] : part.faceRgb[from];
        target[i + corner + 1] = from < 0 ? PRIMER_RGB[1] : part.faceRgb[from + 1];
        target[i + corner + 2] = from < 0 ? PRIMER_RGB[2] : part.faceRgb[from + 2];
      }
    }
    attribute.needsUpdate = true;
    requestRender();
  }

  // parts: [{ id, url, faceRgb?: Uint8Array (one colour per face), colorKey?: string }]
  async function showAssembled(parts, selectedId) {
    if (mode !== "assembled") {
      clear();
      mode = "assembled";
    }
    generation += 1;                         // loads started for an earlier list must not land in this one
    const mine = generation;
    selected = selectedId;
    const wanted = new Map(parts.map(part => [part.id, part]));
    for (const [id, mesh] of [...meshes]) {
      if (wanted.get(id)?.url !== mesh.userData.url) remove(id);
    }
    if (meshes.size === 0) framedRadius = 0;
    for (const [id, mesh] of meshes) colour(mesh, wanted.get(id));
    restyle();
    await Promise.all(parts.filter(part => !meshes.has(part.id)).map(async part => {
      const geometry = await loadAssembledGeometry(part.url);
      if (mine !== generation || meshes.has(part.id)) return;
      colour(add(part.id, part.url, geometry), part);      // the figure appears piece by piece
      frame(false);
    }));
  }

  function setSelected(id) {
    selected = id;
    restyle();
  }

  // -- picking a part in the assembled figure ---------------------------------------------------

  let down = null;
  function onPointerDown(event) { down = { x: event.clientX, y: event.clientY }; }
  function onPointerUp(event) {
    const start = down;
    down = null;
    if (!start || mode !== "assembled") return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4) return;   // that was a drag
    const box = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
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
        idStale = true;
        requestRender();
        left -= 1;
        if (left > 0) requestAnimationFrame(step);
        else requestAnimationFrame(() => resolve(stats()));
      })();
    });
  }

  // Turn the camera around the vertical axis by an angle in degrees (used by checks and, later, the agent).
  function orbitBy(degrees) {
    camera.position.sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(degrees))
      .add(controls.target);
    controls.update();
    idStale = true;
    requestRender();
  }

  window.__viewerStats = stats;
  window.__viewerBenchmark = benchmark;
  applyTheme();

  return {
    showPart,
    showPaint,
    setPaintData,
    refreshColors,
    setTool,
    onStroke(callback) { onStroke = callback; },
    pickFace,
    showAssembled,
    setSelected,
    clear,
    orbitBy,
    onPick(callback) { pick = callback; },
    stats,
    dispose() {
      generation += 1;
      resizer.disconnect();
      scheme.removeEventListener("change", applyTheme);
      canvas.removeEventListener("pointerdown", onPaintDown, { capture: true });
      canvas.removeEventListener("pointermove", onPaintMove, { capture: true });
      canvas.removeEventListener("pointerup", onPaintUp, { capture: true });
      canvas.removeEventListener("pointercancel", onPaintUp, { capture: true });
      canvas.removeEventListener("pointerleave", onPaintLeave);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      for (const material of [primer, painted, dimmed, chosen, idMaterial, ring.material]) material.dispose();
      ring.geometry.dispose();
      idTarget.dispose();
      renderer.dispose();
      delete window.__viewerStats;
      delete window.__viewerBenchmark;
    },
  };
}
