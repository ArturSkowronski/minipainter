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
