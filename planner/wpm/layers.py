"""From a recipe to the steps at the desk: which paint, or which mix of two, each layer is.

Nothing here talks to minipainter or to disk: `resolve` takes the recipe and the list of owned paints.
What kind of product a paint is comes from its `format` (minipainter's `product_format`) and from
nothing else.
"""
import math

from wpm import colour

# A stage profile is the order of work. Other ways of painting (zenithal, speedpaint) are other profiles.
STAGE_PROFILES = {
    "layered": {"id": "layered", "stages": ["primer", "base", "layers", "shade", "lining", "highlight", "ink"]},
}
DEFAULT_PROFILE = "layered"
OPTIONAL = ("shade", "lining", "highlight", "ink")       # stages a recipe can switch off
MAX_LAYERS = 6
MODES = ("auto", "bottles", "mixes")
# Parts of base : parts of highlight, simplest first: on a tie the simpler ratio wins.
RATIOS = ((1, 1), (2, 1), (1, 2), (3, 1), (1, 3), (3, 2), (2, 3), (4, 1), (1, 4))
# How far (OKLab) an owned bottle may be from a layer's colour and still be used instead of a mix.
# 0.02 is about the smallest difference one sees. Tried on Artur's 89 paints: at 0.04 a near-black
# recipe takes Mechanicus Standard Grey (0.018 away) for its second layer; at 0.06 it also takes
# Rhinox Hide, a brown, for the first. Half of all colours have no covering paint within 0.08.
DEFAULT_BOTTLE_DISTANCE = 0.04
BOTTLES_REACH = 2.0                                      # "prefer bottles" accepts this many times the distance
COVERING = ("opaque_base", "opaque_layer")
LINING_DARKEN = 0.45


def _nearest(paints: list[dict], target: str, measure=colour.distance) -> tuple[dict | None, float]:
    best, best_distance = None, math.inf
    for paint in paints:
        d = measure(target, paint["hex"])
        if d < best_distance:
            best, best_distance = paint, d
    return best, best_distance


def _tint_distance(first: str, second: str) -> float:
    """Hue and saturation count fully, lightness half: a wash's bottle colour says little about how dark it dries."""
    a, b = colour.to_oklab(first), colour.to_oklab(second)
    return math.sqrt((0.5 * (a[0] - b[0])) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def _step(key: str, stage: str, **fields) -> dict:
    step = {"key": key, "stage": stage, "index": None, "of": None, "target": None, "paint": None, "mix": None,
            "color": None, "distance": None, "pinned": False, "stale_pin": None, "note": "", "threshold": None}
    step.update(fields)
    return step


class _Pins:
    """Looks pins up among the owned paints; a pin naming a paint that is gone is remembered as stale."""

    def __init__(self, recipe: dict, paints: list[dict]):
        self._pins = recipe.get("pins") or {}
        self._owned = {p["id"]: p for p in paints}

    def get(self, key: str) -> tuple[dict | None, list[dict] | None, str | None]:
        """(paint, mix, stale id) for a pin key; all None when there is no pin."""
        pin = self._pins.get(key)
        if not pin:
            return None, None, None
        if "paint" in pin:
            paint = self._owned.get(pin["paint"])
            return (paint, None, None) if paint else (None, None, pin["paint"])
        parts = pin.get("mix") or []
        missing = next((m["paint"] for m in parts if m["paint"] not in self._owned), None)
        if missing or len(parts) != 2:
            return None, None, missing
        return None, [{"paint": self._owned[m["paint"]], "parts": m["parts"]} for m in parts], None


def _mix_colour(mix: list[dict]) -> str:
    first, second = mix
    return colour.mix(first["paint"]["hex"], second["paint"]["hex"], second["parts"] / (first["parts"] + second["parts"]))


def _covering_step(key: str, target: str, pins: _Pins, candidates: list[dict]) -> dict:
    """Base or highlight: the pin, else the nearest covering paint however far it is."""
    paint, _, stale = pins.get(key)
    pinned = paint is not None
    if paint is None:
        paint, _ = _nearest(candidates, target)
    shown = paint["hex"] if paint else target
    return _step(key, key, target=target, paint=paint, color=shown, distance=colour.distance(target, shown),
                 pinned=pinned, stale_pin=stale)


def _tint_step(key: str, wanted: str, pins: _Pins, candidates: list[dict], measure) -> dict:
    """Shade, lining or ink: the pin, else the nearest paint of the right kind; no colour of its own."""
    paint, _, stale = pins.get(key)
    pinned = paint is not None
    if paint is None:
        paint, _ = _nearest(candidates, wanted, measure)
    return _step(key, key, paint=paint, color=paint["hex"] if paint else wanted, pinned=pinned, stale_pin=stale)


def _places(candidates: list[dict], start: str, end: str) -> dict[str, float]:
    """Paint id -> where its colour falls on the line from `start` (0) to `end` (1). Empty when the two are one colour."""
    origin, far = colour.to_oklab(start), colour.to_oklab(end)
    along = [f - o for o, f in zip(origin, far)]
    length = sum(a * a for a in along)
    if length < 1e-9:
        return {}
    return {p["id"]: sum((c - o) * a for c, o, a in zip(colour.to_oklab(p["hex"]), origin, along)) / length
            for p in candidates}


def _layer_steps(recipe: dict, pins: _Pins, candidates: list[dict], base: dict, highlight: dict, limit: float) -> list[dict]:
    count = recipe["layers"]
    used = {step["paint"]["id"] for step in (base, highlight) if step["paint"]}
    # A bottle may stand in for a layer only if it lies in that layer's stretch of the blend. Without
    # this the nearest bottle is taken by whichever layer asks first, and a lighter layer can end up
    # under a darker one.
    places = _places(candidates, base["color"], highlight["color"])
    half_step = 0.5 / (count + 1)
    can_mix = bool(base["paint"] and highlight["paint"] and base["paint"]["id"] != highlight["paint"]["id"])
    steps = []
    for k in range(1, count + 1):
        share = k / (count + 1)
        target = colour.mix(base["color"], highlight["color"], share)
        paint, mix, stale = pins.get(f"layer:{k}/{count}")
        pinned = paint is not None or mix is not None
        if not pinned and limit > 0:
            fitting = [p for p in candidates
                       if p["id"] not in used and p["id"] in places and abs(places[p["id"]] - share) < half_step]
            bottle, gap = _nearest(fitting, target)
            if bottle is not None and gap < limit:
                paint = bottle
        if paint is None and mix is None and can_mix:
            parts = min(RATIOS, key=lambda r: abs(r[1] / (r[0] + r[1]) - share))
            mix = [{"paint": base["paint"], "parts": parts[0]}, {"paint": highlight["paint"], "parts": parts[1]}]
        if paint is not None:
            used.add(paint["id"])
        shown = paint["hex"] if paint else _mix_colour(mix) if mix else target
        steps.append(_step(f"layer:{k}", "layers", index=k, of=count, target=target, paint=paint, mix=mix,
                           color=shown, distance=colour.distance(target, shown), pinned=pinned, stale_pin=stale))
    return steps


def step_keys(recipe: dict, profile: str = DEFAULT_PROFILE) -> list[str]:
    """The keys of the steps `resolve` returns, without resolving anything."""
    keys = []
    for stage in STAGE_PROFILES[profile]["stages"]:
        if stage == "base":
            keys.append("base")
        elif stage == "layers":
            keys += [f"layer:{k}" for k in range(1, recipe["layers"] + 1)]
        elif stage in OPTIONAL and recipe["use"].get(stage):
            keys.append(stage)
    return keys


def resolve(recipe: dict, paints: list[dict], profile: str = DEFAULT_PROFILE,
            bottle_distance: float = DEFAULT_BOTTLE_DISTANCE) -> list[dict]:
    """The recipe's steps in the profile's order (the primer is the figure's, not a recipe's)."""
    pins = _Pins(recipe, paints)
    covering = [p for p in paints if p["format"] in (("metallic",) if recipe.get("metallic") else COVERING)]
    washes = [p for p in paints if p["format"] == "wash"]
    tints = [p for p in paints if p["format"] in ("ink", "contrast")]

    base = _covering_step("base", recipe["base"], pins, covering)
    # The highlight is resolved even when its stage is off: the layers blend towards it.
    highlight = _covering_step("highlight", recipe.get("highlight") or colour.lighten(recipe["base"]), pins, covering)
    limit = {"auto": bottle_distance, "bottles": bottle_distance * BOTTLES_REACH, "mixes": 0}[recipe["mode"]]
    shaded = colour.darken(recipe["base"])
    made = {
        "base": [base],
        "layers": _layer_steps(recipe, pins, covering, base, highlight, limit),
        "shade": [_tint_step("shade", shaded, pins, washes, _tint_distance)],
        "lining": [_tint_step("lining", colour.darken(recipe["base"], LINING_DARKEN), pins, washes, colour.distance)],
        "highlight": [highlight],
        # A glaze is chosen by the colour it adds, so by the base itself: contrast paints are catalogued
        # as they look over white, not as dark as they pool.
        "ink": [_tint_step("ink", recipe["base"], pins, tints, _tint_distance)],
    }
    made["lining"][0]["threshold"] = recipe["lining_threshold"]

    notes = recipe.get("notes") or {}
    steps = []
    for stage in STAGE_PROFILES[profile]["stages"]:
        if stage == "primer" or (stage in OPTIONAL and not recipe["use"].get(stage)):
            continue
        for step in made[stage]:
            step["note"] = notes.get(stage, "")
            steps.append(step)
    return steps
