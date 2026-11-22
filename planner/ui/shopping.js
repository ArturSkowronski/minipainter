// The shopping list: which steps of the recipes in use lack a paint, and which paints of the catalogue
// would fill them. It asks the server each time it is opened and changes nothing.
import { h } from "./dom.js";
import { GRADE_LABEL, describePaint, gapReason, nearness, servesText, shoppingText } from "./shoppingmodel.js";
import { stepLabel } from "./stagemodel.js";

// load(): a promise of the server's answer { inventory, recipes, unused, gaps, buy }.
export function createShoppingDialog({ load }) {
  let asked = 0;                  // only the answer to the latest opening is drawn
  const body = h("div", { class: "shop-body" });
  const box = h("div", { class: "shop-box" },
    h("header", { class: "shop-head" },
      h("h2", { id: "shop-title" }, "Czego brakuje"),
      h("button", { type: "button", class: "plain icon", "aria-label": "Zamknij", onclick: () => dialog.close() }, "×")),
    body);
  const dialog = h("dialog", { class: "shop", "aria-labelledby": "shop-title" }, box);
  // The dialog element itself is only hit outside the box: on the backdrop.
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });

  const swatch = (hex, title) => h("span", { class: "swatch", style: `background:${hex}`, title });
  const show = (...nodes) => body.replaceChildren(...nodes.flat().filter(node => node !== null));

  function buyRow(entry, recipes) {
    const serves = servesText(entry, recipes);
    return h("li", { class: "shop-paint" }, swatch(entry.paint.hex, entry.paint.hex),
      h("div", {},
        h("strong", {}, entry.paint.name), h("span", { class: "muted" }, ` · ${describePaint(entry.paint)}`),
        serves ? h("div", { class: "muted small" }, serves) : null));
  }

  function gapRow(gap) {
    return h("li", { class: "gap" },
      h("div", { class: "gap-head" }, swatch(gap.wanted, `szukany kolor ${gap.wanted}`),
        h("div", {},
          h("strong", {}, stepLabel(gap)), gap.grade === "better" ? h("span", { class: "tag" }, "warto") : null,
          h("div", { class: "muted" }, gapReason(gap),
            gap.have ? [" ", h("span", { class: "swatch tiny", style: `background:${gap.have.hex}`, title: `${gap.have.name} ${gap.have.hex}` })] : null))),
      gap.options.length
        ? h("ul", { class: "options" }, gap.options.map(option =>
          h("li", {}, swatch(option.hex, option.hex),
            h("span", {}, option.name, h("span", { class: "muted" }, ` · ${describePaint(option)} · ${nearness(option.distance)}`)),
            option.id === gap.pick ? h("span", { class: "tag" }, "na liście") : null)))
        : h("p", { class: "warn small" }, "W katalogu nie ma farby, która by tu pasowała."));
  }

  function copyButton(answer) {
    const button = h("button", {
      type: "button", class: "plain",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(shoppingText(answer));
          button.textContent = "Skopiowano";
        } catch {
          button.textContent = "Nie udało się skopiować";
        }
      },
    }, "Kopiuj listę");
    return button;
  }

  function draw(answer) {
    const { inventory, recipes, unused, gaps, buy } = answer;
    if (inventory.state === "error") {
      show(
        h("p", { class: "warn" }, "Nie udało się odczytać farb z mpaint, więc nie wiem, co masz ani co jest w katalogu."),
        h("p", { class: "muted small" }, inventory.error ?? ""));
      return;
    }
    if (!recipes.length) {
      show(h("p", {}, "Nie ma jeszcze żadnej receptury, więc nie ma czego sprawdzać."));
      return;
    }
    const scope = h("p", { class: "muted small" },
      `Sprawdzone receptury: ${recipes.map(recipe => recipe.name).join(", ")}. `,
      `Masz ${inventory.count} farb, katalog mpaint ma ${inventory.catalogue}.`,
      unused.length ? ` Pominięte, bo żadna strefa ich nie używa: ${unused.join(", ")}.` : "");
    const onlyOwned = inventory.catalogue <= inventory.count
      ? h("p", { class: "warn small" }, "Polecenie mpaint podało tylko posiadane farby, więc nie mam z czego proponować.") : null;
    if (!gaps.length) {
      show(scope, onlyOwned,
        h("p", {}, "Niczego nie brakuje: każdy krok tych receptur ma farbę blisko swojego koloru."));
      return;
    }
    const lists = ["missing", "better"].flatMap(grade => {
      const entries = buy.filter(entry => entry.grade === grade);
      return entries.length ? [h("h3", {}, `${GRADE_LABEL[grade]} (${entries.length})`),
        h("ul", { class: "shop-list" }, entries.map(entry => buyRow(entry, recipes)))] : [];
    });
    const reasons = recipes.filter(recipe => gaps.some(gap => gap.recipe === recipe.id)).map(recipe =>
      h("section", { class: "shop-recipe" },
        h("div", { class: "shop-recipe-head" }, swatch(recipe.base, recipe.base),
          h("div", {}, h("strong", {}, recipe.name),
            recipe.zones.length ? h("div", { class: "muted small" },
              `obszar: ${recipe.zones.map(zone => `${zone.part} · ${zone.zone}`).join(", ")}`) : null)),
        h("ul", { class: "gaps" }, gaps.filter(gap => gap.recipe === recipe.id).map(gapRow))));
    show(scope, onlyOwned, ...lists,
      buy.length ? h("div", { class: "shop-actions" }, copyButton(answer)) : null,
      h("h3", {}, "Skąd te propozycje"),
      h("p", { class: "muted small" },
        "Dla każdego kroku najbliższa farba z każdej marki. Pierwsza trafia na listę; pozostałe to zamienniki. ",
        "Kolory katalogu są przybliżone, więc przed zakupem porównaj odcień z próbką."),
      ...reasons);
  }

  async function open() {
    const mine = ++asked;
    show(h("p", { class: "muted" }, "Sprawdzam receptury i katalog…"));
    if (!dialog.open) dialog.showModal();
    try {
      const answer = await load();
      if (mine === asked) draw(answer);
    } catch (failure) {
      if (mine === asked) {
        show(h("p", { class: "warn" },
          failure.status ? `Nie udało się przygotować listy: ${failure.message}` : "Nie udało się przygotować listy — serwer nie odpowiada."));
      }
    }
  }

  return { element: dialog, open, isOpen: () => dialog.open, dispose() { dialog.close(); dialog.remove(); } };
}
