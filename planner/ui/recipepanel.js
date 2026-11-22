// The right-hand panel of the painting view: the primer, one recipe's settings, and its steps with the
// paints they resolve to. It shows what it is given and reports what the user did; it calls no server.
import { h } from "./dom.js";
import { FORMAT_LABEL, HOW, WHERE, mixText, nearestFirst, stepAt, stepLabel } from "./stagemodel.js";

const MODES = [["auto", "automatycznie"], ["bottles", "wolę gotowe farby"], ["mixes", "wolę mieszanki"]];
const OPTIONAL = [["shade", "Cień"], ["lining", "Linie"], ["highlight", "Rozjaśnienie"], ["ink", "Tusz"]];
const PRIMERS = [["#141414", "Czarny"], ["#8b8e93", "Szary"], ["#e8e8e4", "Biały"]];
const PROVIDER = { citadel: "Citadel", army_painter: "Army Painter", vallejo: "Vallejo", ak_interactive: "AK Interactive" };
// Which kinds of paint come first in the list offered for a step that has no colour of its own.
const TINT_ORDER = { shade: ["wash", "contrast", "ink"], lining: ["wash", "ink", "contrast"], ink: ["contrast", "ink", "wash"] };
const FAR = 0.08;      // OKLab distance beyond which the nearest owned paint is not really the colour asked for

// actions: selectRecipe(id), createRecipe(), deleteRecipe(id), changeRecipe(id, changes), setPrimer(hex),
//          toggleDone(recipeId, stepKey, done), goTo(stepKey), refreshInventory()
export function createRecipePanel(actions) {
  let view = null;         // what update() was last given
  let picker = null;       // key of the step whose paint list is open
  let filter = "";
  let confirming = false;
  let drawnSteps = "";

  const change = changes => { if (view?.recipe) actions.changeRecipe(view.recipe.id, changes); };

  // -- primer -------------------------------------------------------------------------------------
  const primerInput = h("input", {
    type: "color", id: "primer-colour", onchange: () => actions.setPrimer(primerInput.value),
  });
  const primerBox = h("section", { class: "panel-row" },
    h("label", { class: "label", for: "primer-colour" }, "Podkład"),
    h("div", { class: "pair" }, primerInput,
      PRIMERS.map(([hex, name]) => h("button", { type: "button", class: "plain", onclick: () => actions.setPrimer(hex) }, name))));

  // -- which recipe -------------------------------------------------------------------------------
  const recipeSelect = h("select", {
    id: "recipe", onchange: () => { confirming = false; actions.selectRecipe(recipeSelect.value || null); },
  });
  const addButton = h("button", {
    type: "button", class: "plain", title: "Nowa receptura", "aria-label": "Nowa receptura", onclick: () => actions.createRecipe(),
  }, "＋");
  const deleteBox = h("span", { class: "pair" });
  const usedBy = h("p", { class: "muted small" });
  const chooserBox = h("section", {},
    h("label", { class: "label", for: "recipe" }, "Receptura"),
    h("div", { class: "pair chooser" }, recipeSelect, addButton, deleteBox),
    usedBy);

  // -- the recipe's settings: built once, values written into it ------------------------------------
  const field = {
    name: h("input", { type: "text", id: "r-name", maxLength: 60, onchange: e => change({ name: e.target.value }),
      onkeydown: e => { if (e.key === "Enter") e.target.blur(); } }),
    base: h("input", { type: "color", id: "r-base", onchange: e => change({ base: e.target.value }) }),
    highlight: h("input", { type: "color", id: "r-highlight", onchange: e => change({ highlight: e.target.value }) }),
    auto: h("input", { type: "checkbox", id: "r-auto",
      onchange: e => change({ highlight: e.target.checked ? null : field.highlight.value }) }),
    layers: h("input", { type: "range", id: "r-layers", min: "0", max: "6", step: "1",
      oninput: e => { layersValue.textContent = e.target.value; change({ layers: Number(e.target.value) }); } }),
    mode: h("select", { id: "r-mode", onchange: e => change({ mode: e.target.value }) },
      MODES.map(([value, label]) => h("option", { value }, label))),
    metallic: h("input", { type: "checkbox", id: "r-metallic", onchange: e => change({ metallic: e.target.checked }) }),
    threshold: h("input", { type: "range", id: "r-threshold", min: "0.05", max: "0.95", step: "0.05",
      onchange: e => change({ lining_threshold: Number(e.target.value) }) }),
    material: h("input", { type: "text", id: "r-material", maxLength: 200, placeholder: "np. tkanina, skóra, metal",
      onchange: e => change({ material: e.target.value }), onkeydown: e => { if (e.key === "Enter") e.target.blur(); } }),
  };
  const use = Object.fromEntries(OPTIONAL.map(([stage]) =>
    [stage, h("input", { type: "checkbox", id: `r-use-${stage}`, onchange: e => change({ use: { [stage]: e.target.checked } }) })]));
  const layersValue = h("output", { for: "r-layers" });
  const thresholdRow = h("label", { class: "field", for: "r-threshold", title: "Jak głęboki musi być rowek, żeby dostał linię" },
    "Głębokość linii", field.threshold);
  const formBox = h("section", { class: "recipe-form", hidden: true },
    h("label", { class: "field", for: "r-name" }, "Nazwa", field.name),
    h("div", { class: "colours" },
      h("label", { class: "field", for: "r-base" }, "Baza", field.base),
      h("label", { class: "field", for: "r-highlight" }, "Rozjaśnienie", field.highlight),
      h("label", { class: "field check", for: "r-auto", title: "Rozjaśnienie liczone z koloru bazy" }, field.auto, "auto")),
    h("label", { class: "field", for: "r-layers" }, "Warstwy pośrednie", field.layers, layersValue),
    h("label", { class: "field", for: "r-mode" }, "Dobór farb", field.mode),
    h("div", { class: "switches" },
      OPTIONAL.map(([stage, label]) => h("label", { class: "field check", for: `r-use-${stage}` }, use[stage], label)),
      h("label", { class: "field check", for: "r-metallic", title: "Dobieraj tylko farby metaliczne" }, field.metallic, "Metaliczna")),
    thresholdRow,
    h("label", { class: "field", for: "r-material" }, "Materiał", field.material));

  // -- steps --------------------------------------------------------------------------------------
  const stepsBox = h("section", { class: "steps" });
  const inventoryBox = h("section", { class: "inventory muted small" });
  const element = h("aside", { class: "panel", hidden: true, "aria-label": "Receptura i kroki malowania" },
    primerBox, chooserBox, formBox, stepsBox, inventoryBox);

  const set = (control, value) => { if (document.activeElement !== control && control.value !== value) control.value = value; };

  function drawChooser() {
    const { plan, recipe } = view;
    const options = plan.recipes.map(r => [r.id, r.name]);
    const key = JSON.stringify(options);
    if (recipeSelect.dataset.key !== key) {
      recipeSelect.dataset.key = key;
      recipeSelect.replaceChildren(
        ...(options.length ? [] : [h("option", { value: "" }, "— brak receptur —")]),
        ...options.map(([value, name]) => h("option", { value }, name)));
    }
    recipeSelect.value = recipe?.id ?? "";
    recipeSelect.disabled = options.length === 0;
    deleteBox.replaceChildren(...(!recipe ? [] : confirming
      ? [h("span", { class: "small" }, "Usunąć?"),
        h("button", { type: "button", class: "plain", onclick: () => { confirming = false; actions.deleteRecipe(recipe.id); } }, "Tak"),
        h("button", { type: "button", class: "plain", onclick: () => { confirming = false; drawChooser(); } }, "Nie")]
      : [h("button", {
        type: "button", class: "plain icon", title: "Usuń recepturę", "aria-label": `Usuń recepturę ${recipe.name}`,
        onclick: () => { confirming = true; drawChooser(); },
      }, "×")]));
    usedBy.textContent = !recipe ? "Receptura opisuje, jak malować jeden rodzaj powierzchni. Utwórz ją tutaj albo z listy stref."
      : view.usedBy.length ? `Używana przez: ${view.usedBy.join(", ")}` : "Żadna strefa jeszcze jej nie używa.";
  }

  function drawForm() {
    const { recipe, steps } = view;
    formBox.hidden = !recipe;
    if (!recipe) return;
    set(field.name, recipe.name);
    set(field.base, recipe.base);
    // With "auto" the colour shown is the one the layers really blend towards.
    const lightest = steps.find(step => step.key === "highlight")?.target ?? steps.findLast(step => step.stage === "layers")?.target;
    set(field.highlight, recipe.highlight ?? lightest ?? recipe.base);
    field.highlight.disabled = recipe.highlight === null;
    field.auto.checked = recipe.highlight === null;
    set(field.layers, String(recipe.layers));
    layersValue.textContent = String(recipe.layers);
    set(field.mode, recipe.mode);
    field.metallic.checked = recipe.metallic;
    for (const [stage] of OPTIONAL) use[stage].checked = recipe.use[stage];
    thresholdRow.hidden = !recipe.use.lining;
    set(field.threshold, String(recipe.lining_threshold));
    set(field.material, recipe.material);
  }

  function paintLine(step) {
    const describe = paint => [paint.name, h("span", { class: "muted" },
      ` · ${PROVIDER[paint.provider] ?? paint.provider} · ${FORMAT_LABEL[paint.format] ?? paint.format}`)];
    if (step.paint) return describe(step.paint);
    if (step.mix) return [h("strong", {}, mixText(step)), ` ${step.mix[0].paint.name} + ${step.mix[1].paint.name}`];
    return h("span", { class: "warn" }, "brak takiej farby w inwentarzu");
  }

  function offered(step) {
    const paints = view.paints;
    if (step.target) return nearestFirst(paints, step.target);
    const order = TINT_ORDER[step.stage] ?? [];
    const rank = paint => (order.indexOf(paint.format) + 1) || order.length + 1;
    return [...paints].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "pl"));
  }

  function fillPaints(list, step) {
    const pinKey = step.stage === "layers" ? `layer:${step.index}/${step.of}` : step.key;
    const pin = value => { picker = null; filter = ""; change({ pins: { [pinKey]: value } }); };
    const wanted = filter.trim().toLowerCase();
    list.replaceChildren(
      h("li", {}, h("button", { type: "button", onclick: () => pin(null) }, h("span", { class: "swatch auto" }), "Automatycznie")),
      ...offered(step).filter(paint => paint.name.toLowerCase().includes(wanted)).map(paint =>
        h("li", {}, h("button", { type: "button", onclick: () => pin({ paint: paint.id }) },
          h("span", { class: "swatch", style: `background:${paint.hex}` }), paint.name,
          h("span", { class: "muted" }, FORMAT_LABEL[paint.format] ?? paint.format)))));
  }

  function pickerBox(step) {
    const list = h("ul", { class: "paint-list" });
    fillPaints(list, step);
    return h("div", { class: "picker" },
      h("input", {
        type: "search", placeholder: "Szukaj farby", value: filter, "aria-label": "Szukaj farby",
        oninput: event => { filter = event.target.value; fillPaints(list, step); },
      }),
      list);
  }

  function stepRow(step, current) {
    const { recipe, part } = view;
    const done = !!part?.progress?.[recipe.id]?.includes(step.key);
    return h("li", {
      class: "step", "aria-current": current ? "true" : null, "data-done": String(done),
      onclick: event => { if (!event.target.closest("button, input, textarea, .picker")) actions.goTo(step.key); },
    },
    part ? h("input", {
      type: "checkbox", checked: done, title: `Zrobione na części ${part.name}`,
      "aria-label": `${stepLabel(step)} zrobione na części ${part.name}`,
      onchange: event => actions.toggleDone(recipe.id, step.key, event.target.checked),
    }) : h("span"),
    h("span", { class: "swatch", style: `background:${step.color}` }),
    h("div", { class: "step-body" },
      h("div", { class: "step-title" }, h("span", { class: "step-name" }, stepLabel(step)),
        step.pinned ? h("span", { class: "tag" }, "przypięte") : null),
      h("div", { class: "step-paint" }, paintLine(step)),
      step.paint && step.target && step.distance > FAR ? h("div", { class: "warn small" },
        "najbliższa posiadana farba jest daleko od koloru ", h("span", { class: "swatch tiny", style: `background:${step.target}` })) : null,
      step.stale_pin ? h("div", { class: "warn small" }, "przypiętej farby nie ma już w inwentarzu") : null,
      current ? h("div", { class: "step-detail" },
        h("p", {}, h("span", { class: "muted" }, "Gdzie: "), WHERE[step.stage]),
        h("p", {}, h("span", { class: "muted" }, "Jak: "), HOW[step.stage]),
        h("textarea", {
          rows: 2, maxLength: 500, placeholder: "Własna uwaga do tego etapu", "aria-label": "Uwaga do etapu", value: step.note,
          onchange: event => change({ notes: { [step.stage]: event.target.value } }),
        })) : null),
    h("button", {
      type: "button", class: "plain small", "aria-expanded": String(picker === step.key),
      onclick: () => { picker = picker === step.key ? null : step.key; filter = ""; drawnSteps = ""; drawSteps(); },
    }, "zmień"),
    picker === step.key ? pickerBox(step) : null);
  }

  function drawSteps() {
    const { recipe, steps, part, position, stages } = view;
    stepsBox.hidden = !recipe;
    if (!recipe) { drawnSteps = ""; return; }
    const current = stepAt(steps, position, stages)?.key ?? null;
    const key = JSON.stringify([recipe.id, steps, part?.id, part?.progress?.[recipe.id], current, picker, view.paints.length]);
    const typing = stepsBox.contains(document.activeElement) && ["TEXTAREA", "INPUT"].includes(document.activeElement.tagName)
      && document.activeElement.type !== "checkbox";
    if (key === drawnSteps || typing) return;
    drawnSteps = key;
    if (picker && !steps.some(step => step.key === picker)) picker = null;
    stepsBox.replaceChildren(
      h("span", { class: "label" }, part ? `Kroki · ${part.name}` : "Kroki"),
      h("ol", { class: "step-list" }, steps.map(step => stepRow(step, step.key === current))));
  }

  function drawInventory() {
    const { inventory } = view;
    const refresh = h("button", { type: "button", class: "plain small", onclick: () => actions.refreshInventory() }, "odśwież");
    if (!inventory || inventory.state === "unread") inventoryBox.replaceChildren("Inwentarz: wczytywanie…");
    else if (inventory.state === "error") {
      inventoryBox.replaceChildren(
        h("span", { class: "warn", title: inventory.error }, "Nie udało się odczytać inwentarza mpaint — kroki pokazują same kolory."), " ", refresh);
    } else inventoryBox.replaceChildren(`Inwentarz mpaint: ${inventory.count} farb `, refresh);
  }

  return {
    element,
    // view: { plan, recipe (or null), steps (of that recipe), usedBy: [text], part (or null), position, stages,
    //         paints: [paint], inventory: status }
    update(next) {
      view = next;
      set(primerInput, view.plan.primer);
      drawChooser();
      drawForm();
      drawSteps();
      drawInventory();
    },
  };
}
