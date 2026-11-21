// Screens and wiring. Rendering is plain DOM; what to show comes from model.js, the 3D stage from viewer.js.
import * as api from "./api.js";
import {
  KIND_LABEL, ROLE_LABEL, STATUS_LABEL, activeVariant, assembledParts, firstViewablePart, progress,
  routeFromHash,
} from "./model.js";
import { createViewer } from "./viewer.js";

const root = document.getElementById("app");
let teardown = () => {};

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else if (key in node && key !== "list") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.flat().filter(child => child !== null && child !== undefined && child !== false));
  return node;
}

function route() {
  teardown();
  teardown = () => {};
  root.replaceChildren();
  const target = routeFromHash(location.hash);
  if (target.screen === "project") teardown = projectScreen(target.slug);
  else startScreen();
}

window.addEventListener("hashchange", route);
route();

// ---------------------------------------------------------------------------------------------------
// Start: open a directory, or pick a recent project.

function startScreen() {
  document.title = "warpaint-model";
  const error = h("p", { class: "form-error", role: "alert" });
  const input = h("input", {
    id: "path", type: "text", placeholder: "Ścieżka do katalogu modelu", autocomplete: "off",
    spellcheck: false, "aria-label": "Ścieżka do katalogu modelu",
  });
  const button = h("button", { class: "btn", type: "submit" }, "Otwórz");
  const form = h("form", {
    class: "open-form",
    onsubmit: async event => {
      event.preventDefault();
      error.textContent = "";
      button.disabled = true;
      try {
        const { slug } = await api.openProject(input.value);
        location.hash = `#p/${slug}`;
      } catch (failure) {
        error.textContent = failure.message;
        button.disabled = false;
      }
    },
  }, input, button);
  const list = h("ul");
  const recent = h("section", { class: "recent", hidden: true }, h("h2", {}, "Ostatnie"), list);
  root.append(h("main", { class: "start" },
    h("h1", {}, "Otwórz paczkę"),
    h("div", {}, form, error),
    recent));
  input.focus();

  api.listProjects().then(projects => {
    recent.hidden = projects.length === 0;
    list.replaceChildren(...projects.map(project => h("li", {},
      h("a", { href: `#p/${project.slug}` }, project.name, h("span", { class: "path" }, project.source)))));
  }).catch(failure => { error.textContent = failure.message; });
}

// ---------------------------------------------------------------------------------------------------
// Project: variant, parts and references on the left; the stage on the right.

function projectScreen(slug) {
  const state = { plan: null, selected: null, mode: "part" };
  let fetching = false;
  let stale = false;
  let closed = false;
  let lightbox = null;
  const drawn = { variants: "", refs: "" };

  const title = h("h1", {}, "…");
  const variantSelect = h("select", { id: "variant", onchange: onVariant });
  const partsBox = h("div");
  const refsBox = h("div", { class: "refs" });
  const refsSection = h("section", { hidden: true }, h("span", { class: "label" }, "Referencje"), refsBox);
  const side = h("aside", { class: "side" },
    h("header", {}, h("a", { href: "#" }, "← Projekty"), title),
    h("section", {}, h("label", { class: "label", for: "variant" }, "Wariant"), variantSelect),
    h("section", {}, partsBox),
    refsSection);

  const modeButtons = {
    part: h("button", { type: "button", onclick: () => setMode("part") }, "Komponent"),
    assembled: h("button", { type: "button", onclick: () => setMode("assembled") }, "Złożona figurka"),
  };
  const info = h("span", { class: "info" });
  const canvas = h("canvas", { "aria-label": "Podgląd modelu" });
  const hint = h("div", { class: "hint" });
  const main = h("div", { class: "main" },
    h("div", { class: "toolbar" },
      h("div", { class: "segmented", role: "group", "aria-label": "Tryb widoku" },
        modeButtons.part, modeButtons.assembled),
      info),
    h("div", { class: "stage" }, canvas, hint));
  root.append(h("div", { class: "project" }, side, main));

  const viewer = createViewer(canvas);
  viewer.onPick(select);
  let shown = "";               // what the stage currently holds, so a plan refresh does not reload it

  const stopWatching = api.watchPlan(slug, revision => {
    if (!state.plan || revision !== state.plan.revision) refresh();
  });
  window.addEventListener("keydown", onKey);
  refresh();

  async function refresh() {
    if (fetching) { stale = true; return; }
    fetching = true;
    try {
      const plan = await api.getPlan(slug);
      if (closed) return;
      state.plan = plan;
      render();
    } catch (failure) {
      if (!closed && !state.plan) {
        root.replaceChildren(h("div", { class: "notice" },
          h("p", {}, failure.message), h("p", {}, h("a", { href: "#" }, "← Projekty"))));
      }
    } finally {
      fetching = false;
      if (stale && !closed) { stale = false; refresh(); }
    }
  }

  async function onVariant() {
    if (!variantSelect.value) return;
    state.selected = null;
    try {
      await api.chooseVariant(slug, variantSelect.value);
    } finally {
      refresh();
    }
  }

  function setMode(mode) {
    state.mode = mode;
    render();
  }

  function select(partId) {
    state.selected = partId;
    render();
  }

  function onKey(event) {
    if (event.key === "Escape") closeLightbox();
  }

  function openLightbox(reference) {
    closeLightbox();
    lightbox = h("div", { class: "lightbox", role: "dialog", "aria-label": reference.id, onclick: closeLightbox },
      h("img", { src: api.fileUrl(slug, reference.file), alt: reference.id, onclick: e => e.stopPropagation() }));
    document.body.append(lightbox);
  }

  function closeLightbox() {
    lightbox?.remove();
    lightbox = null;
  }

  function render() {
    const plan = state.plan;
    const variant = activeVariant(plan);
    document.title = `${plan.name} · warpaint-model`;
    title.textContent = plan.name;

    const variantsKey = JSON.stringify([plan.active_variant, plan.variants.map(v => [v.id, v.name, v.kind])]);
    if (variantsKey !== drawn.variants) {
      drawn.variants = variantsKey;
      variantSelect.replaceChildren(
        variant ? null : h("option", { value: "" }, "— wybierz —"),
        ...plan.variants.map(v => h("option", { value: v.id }, `${v.name} · ${KIND_LABEL[v.kind]}`)));
      variantSelect.value = plan.active_variant ?? "";
    }

    if (variant) {
      const selectedPart = variant.parts.find(p => p.id === state.selected);
      if (!selectedPart || selectedPart.status !== "ready") {
        state.selected = firstViewablePart(variant)?.id ?? null;
      }
    } else {
      state.selected = null;
    }
    const selected = variant?.parts.find(p => p.id === state.selected) ?? null;

    const scroll = side.scrollTop;
    partsBox.replaceChildren(...(variant ? partsList(variant) : []));
    side.scrollTop = scroll;

    const refs = plan.references.filter(r => r.status === "ready");
    const refsKey = refs.map(r => r.id).join(",");
    if (refsKey !== drawn.refs) {
      drawn.refs = refsKey;
      refsSection.hidden = refs.length === 0;
      refsBox.replaceChildren(...referenceRows(refs));
    }

    for (const [mode, button] of Object.entries(modeButtons)) {
      button.setAttribute("aria-pressed", String(state.mode === mode));
    }
    info.textContent = selected
      ? `${selected.name} · ${selected.tris.toLocaleString("pl-PL")} trójkątów`
        + (selected.tris_source > selected.tris ? ` (z ${selected.tris_source.toLocaleString("pl-PL")})` : "")
      : "";
    hint.textContent = !variant ? "Wybierz wariant" : selected ? "" : "Przetwarzanie części…";

    syncViewer(variant, selected);
  }

  function partsList(variant) {
    const { ready, total, failed } = progress(variant);
    const summary = `${ready} z ${total} gotowych` + (failed ? ` · ${failed} z błędem` : "");
    return [
      h("span", { class: "label" }, summary),
      h("ul", { class: "parts" }, variant.parts.map(part => h("li", {},
        h("button", {
          class: "part", type: "button", disabled: part.status !== "ready",
          "data-status": part.status, "data-outlier": String(part.outlier),
          "aria-current": part.id === state.selected ? "true" : null,
          onclick: () => select(part.id),
        },
        h("span", { class: "name", title: part.name }, part.name),
        h("span", { class: "status" }, part.outlier ? "pominięty" : STATUS_LABEL[part.status]),
        part.status === "error" ? h("span", { class: "detail" }, part.error) : null)))),
    ];
  }

  function referenceRows(refs) {
    const roles = [...new Set(refs.map(r => r.role))];
    return roles.map(role => h("div", {},
      h("div", { class: "role" }, ROLE_LABEL[role]),
      h("div", { class: "ref-row" }, refs.filter(r => r.role === role).map(reference =>
        h("button", { class: "ref", type: "button", title: reference.id, onclick: () => openLightbox(reference) },
          h("img", { src: api.fileUrl(slug, reference.file), alt: reference.id, loading: "lazy" }))))));
  }

  function syncViewer(variant, selected) {
    if (!variant || !selected) {
      if (shown) viewer.clear();
      shown = "";
      return;
    }
    const failed = error => { shown = ""; hint.textContent = "Nie udało się wczytać siatki."; console.error(error); };
    if (state.mode === "part") {
      const key = `part:${variant.id}:${selected.id}`;
      if (key === shown) return;
      shown = key;
      viewer.showPart({ id: selected.id, url: api.fileUrl(slug, selected.mesh) }).catch(failed);
    } else {
      const parts = assembledParts(variant);
      const key = `assembled:${variant.id}:${parts.map(part => part.id).join(",")}`;
      if (key === shown) {
        viewer.setSelected(selected.id);
        return;
      }
      shown = key;
      viewer.showAssembled(
        parts.map(part => ({ id: part.id, url: api.fileUrl(slug, part.mesh_lod) })), selected.id).catch(failed);
    }
  }

  return () => {
    closed = true;
    stopWatching();
    window.removeEventListener("keydown", onKey);
    closeLightbox();
    viewer.dispose();
  };
}
