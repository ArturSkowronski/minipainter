// The time-travel slider: one stop per painting stage of what is on screen.
import { h } from "./dom.js";
import { stepLabel } from "./stagemodel.js";

const THUMB = 16;      // px; the labels are placed where the thumb's centre stops

const ROOM = 84;       // px a stop needs for a label like "Rozjaśnienie"; with less, layers are written "W3"

export function createTimeline({ onMove }) {
  let positions = [];
  let drawn = "";
  const range = h("input", {
    type: "range", min: "0", max: "0", step: "1", value: "0", "aria-label": "Etap malowania",
    oninput: () => { const position = positions[Number(range.value)]; if (position) onMove(position.key); },
  });
  const stops = h("div", { class: "stops" });
  const step = by => () => {
    const next = positions[Number(range.value) + by];
    if (next) onMove(next.key);
  };
  const back = h("button", { type: "button", class: "plain icon", "aria-label": "Poprzedni etap", onclick: step(-1) }, "◀");
  const forward = h("button", { type: "button", class: "plain icon", "aria-label": "Następny etap", onclick: step(1) }, "▶");
  const element = h("div", { class: "timeline", hidden: true }, back, h("div", { class: "track" }, range, stops), forward);

  // Many stops on a narrow stage: the labels would run into each other.
  function fit() {
    const width = stops.clientWidth;
    if (width > 0) stops.classList.toggle("tight", width / Math.max(1, positions.length) < ROOM);
  }
  const watcher = new ResizeObserver(fit);
  watcher.observe(stops);

  return {
    element,
    // positions: [{ key, stage, index? }], key: where the slider stands.
    update(next, key) {
      positions = next;
      const at = Math.max(0, positions.findIndex(position => position.key === key));
      const shape = positions.map(position => position.key).join(",");
      if (shape !== drawn) {
        drawn = shape;
        range.max = String(Math.max(0, positions.length - 1));
        const last = Math.max(1, positions.length - 1);
        stops.replaceChildren(...positions.map((position, i) => h("button", {
          type: "button", class: "stop", "data-key": position.key,
          style: `left: calc(${i / last} * (100% - ${THUMB}px) + ${THUMB / 2}px)`,
          title: stepLabel(position), onclick: () => onMove(position.key),
        }, h("span", { class: "full" }, stepLabel(position)),
        h("span", { class: "short", "aria-hidden": "true" }, position.stage === "layers" ? `W${position.index}` : stepLabel(position)))));
      }
      fit();
      range.disabled = positions.length < 2;
      range.value = String(at);
      range.setAttribute("aria-valuetext", positions[at] ? stepLabel(positions[at]) : "");
      back.disabled = at === 0;
      forward.disabled = at >= positions.length - 1;
      for (const stop of stops.children) {
        if (stop.dataset.key === key) stop.setAttribute("aria-current", "true");
        else stop.removeAttribute("aria-current");
      }
    },
    dispose() { watcher.disconnect(); },
    // Move by one stop (for the arrow keys). Returns whether there was a stop to move to.
    nudge(by) {
      const next = positions[Number(range.value) + by];
      if (next) onMove(next.key);
      return !!next;
    },
  };
}
