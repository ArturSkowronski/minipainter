// Talks to the local server. A failed request rejects with the server's own (Polish) message.

async function call(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Błąd serwera (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return body;
}

const post = payload => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
});
const project = slug => `/api/projects/${encodeURIComponent(slug)}`;

export const listProjects = () => call("/api/projects");
export const openProject = path => call("/api/projects", post({ path }));
export const getPlan = slug => call(project(slug));
export const chooseVariant = (slug, variant) => call(`${project(slug)}/variant`, post({ variant }));

// Calls onRevision(n) now and whenever the plan changes. Returns a function that stops watching.
export function watchPlan(slug, onRevision) {
  const source = new EventSource(`${project(slug)}/events`);
  source.onmessage = event => onRevision(JSON.parse(event.data).revision);
  return () => source.close();
}

export const fileUrl = (slug, rel) =>
  `/files/${encodeURIComponent(slug)}/${rel.split("/").map(encodeURIComponent).join("/")}`;

// -- zones of one part ------------------------------------------------------------------------------

const part = (slug, variant, id) =>
  `${project(slug)}/variants/${encodeURIComponent(variant)}/parts/${encodeURIComponent(id)}`;
const json = (method, payload) => ({ ...post(payload), method });

export const createZone = (slug, variant, id, zone = {}) => call(`${part(slug, variant, id)}/zones`, post(zone));
export const updateZone = (slug, variant, id, zone, changes) =>
  call(`${part(slug, variant, id)}/zones/${zone}`, json("PATCH", changes));
export const deleteZone = (slug, variant, id, zone) =>
  call(`${part(slug, variant, id)}/zones/${zone}`, { method: "DELETE" });
export const segment = (slug, variant, id, settings) => call(`${part(slug, variant, id)}/segment`, post(settings));

export async function getZoneFaces(slug, variant, id) {
  const response = await fetch(`${part(slug, variant, id)}/zone-faces`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Błąd serwera (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

// `basedOn` is the zones_rev this array was edited from: the server refuses (409) if it has moved on.
export const putZoneFaces = (slug, variant, id, zones, basedOn) =>
  call(`${part(slug, variant, id)}/zone-faces`, {
    method: "PUT", headers: { "Content-Type": "application/octet-stream", "If-Match": String(basedOn) }, body: zones,
  });

// -- recipes, steps and paints ----------------------------------------------------------------------

const recipe = (slug, id) => `${project(slug)}/recipes/${encodeURIComponent(id)}`;

// { profile: { id, stages }, recipes: { id: [step] }, inventory: status }
export const getSteps = slug => call(`${project(slug)}/steps`);
// Each answers { recipe, steps }: the steps as they resolve with the paints owned now.
export const createRecipe = (slug, fields = {}) => call(`${project(slug)}/recipes`, post(fields));
export const updateRecipe = (slug, id, changes) => call(recipe(slug, id), json("PATCH", changes));
export const deleteRecipe = (slug, id) => call(recipe(slug, id), { method: "DELETE" });
export const updateSettings = (slug, changes) => call(`${project(slug)}/settings`, json("PATCH", changes));
export const setProgress = (slug, variant, id, mark) => call(`${part(slug, variant, id)}/progress`, json("PUT", mark));
// { status: { state, count, loaded, error }, paints: [{ id, name, provider, format, hex }] }
export const getInventory = () => call("/api/inventory");
export const refreshInventory = () => call("/api/inventory/refresh", post({}));
// What to buy for the recipes in use: { inventory, recipes: [{ id, name, base, zones }], unused: [name],
//   gaps: [{ recipe, key, stage, index, of, grade, reason, off, wanted, have, distance, options, pick }],
//   buy: [{ paint, grade, for: [{ recipe, keys }] }] }
export const getMissing = slug => call(`${project(slug)}/missing`);
