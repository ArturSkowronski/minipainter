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
