// Pure functions from the plan to what the screen lists. No DOM, no network: tested with node --test.

export const STATUS_LABEL = {
  pending: "w kolejce", processing: "przetwarzanie…", ready: "gotowe", error: "błąd",
};

export const KIND_LABEL = {
  split: "split", unsplit: "w całości", miniature: "miniatura", bust: "popiersie",
};

export const ROLE_LABEL = {
  colour: "Kolor", turntable: "Obrót", beauty: "Ujęcia", parts: "Części",
  bust: "Popiersie", scale: "Skala", other: "Inne",
};

export function routeFromHash(hash) {
  const match = /^#p\/([a-z0-9-]+)$/.exec(hash || "");
  return match ? { screen: "project", slug: match[1] } : { screen: "start" };
}

export function activeVariant(plan) {
  return plan.variants.find(v => v.id === plan.active_variant) ?? null;
}

export function progress(variant) {
  return {
    ready: variant.parts.filter(p => p.status === "ready").length,
    total: variant.parts.length,
    failed: variant.parts.filter(p => p.status === "error").length,
  };
}

// Parts that belong in the assembled figure: finished, and not flagged as foreign to it.
export function assembledParts(variant) {
  return variant.parts.filter(p => p.status === "ready" && !p.outlier);
}

export function firstViewablePart(variant) {
  return assembledParts(variant)[0] ?? variant.parts.find(p => p.status === "ready") ?? null;
}

// Ready, and its patches and masks exist: the part can be shown for painting.
export function paintable(part) {
  return !!part && part.status === "ready" && part.patches !== null && part.patches !== undefined;
}

const SIDECAR = {
  patches: ".patches.u32", masks: ".masks.u8", lodmap: ".lodmap.u32", lodmasks: ".lodmasks.u8", stats: ".patches.json",
};

// Workspace path of one of a part's analysis files.
export function sidecarPath(part, kind) {
  return part.mesh.replace(/\.glb$/, "") + SIDECAR[kind];
}

// What a key press asks for: "undo", "redo", "back", "forward" (the timeline), "close", or null.
// where: { work: "zones" | "paint", typing: a text field has the focus, onSlider: a slider has it,
//          modal: a dialog is open over the page (it gets every key, Escape included) }
export function keyAction(event, { work, typing, onSlider, modal = false }) {
  if (modal) return null;
  if (event.key === "Escape") return "close";
  if (typing) return null;
  const command = event.metaKey || event.ctrlKey;
  if (!command && !event.altKey && work === "paint" && !onSlider) {
    if (event.key === "ArrowLeft") return "back";
    if (event.key === "ArrowRight") return "forward";
  }
  // Undo belongs to zone strokes; while painting steps are looked at, their tools are not on screen.
  if (!command || work !== "zones") return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  return key === "y" ? "redo" : null;
}
