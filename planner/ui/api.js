// Talks to the local server. A failed request rejects with the server's own (Polish) message.

async function call(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Błąd serwera (${response.status}).`);
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

// keepalive lets a save that starts while the page is closing still reach the server.
export const putZoneFaces = (slug, variant, id, zones, keepalive = false) =>
  call(`${part(slug, variant, id)}/zone-faces`, {
    method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: zones, keepalive,
  });
