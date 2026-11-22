"""What to buy: the steps the owned paints do not really cover, and the catalogue's paints that would.

Nothing here talks to minipainter or to disk. A proposal is tried before it is made: the paint is added
to the owned ones and the recipe resolved again, so what is listed is what `layers.resolve` would use,
and one bottle proposed for one recipe is not proposed again for the next.
"""
import math

from wpm import colour, layers

# Beyond this many bottle distances the nearest owned paint is not the colour asked for ("missing").
# Between one and this many it is only roughly the colour ("better" is on offer).
MISSING_REACH = 2.0
# A proposal has to be nearer than what is owned by this many bottle distances, or it is not worth a trip.
MARGIN = 0.5
BRANDS = 3                      # proposals per gap: the nearest paint of each of this many brands
_ORDER = ("base", "highlight", "layers", "shade", "lining", "ink")      # a later gap may vanish once an earlier is filled


def recommend(recipes: list[dict], owned: list[dict], others: list[dict], profile: str = layers.DEFAULT_PROFILE,
              bottle_distance: float = layers.DEFAULT_BOTTLE_DISTANCE) -> dict:
    """{"gaps": [gap], "buy": [{"paint", "grade", "for": [{"recipe", "keys"}]}]} for these recipes.

    A gap is one step of one recipe: {"recipe", "key", "stage", "index", "of", "grade" ("missing" or
    "better"), "reason", "off", "wanted", "have", "distance", "options", "pick"}. `reason`: "none" (no
    paint for the step), "far" (the owned paint is another colour), "flat" (the highlight is the base
    paint again, so the layers have nowhere to go), "mix" (bottles are preferred and the layer is mixed).
    `options` are paints of `others`, nearest first, each with its `distance`; `pick` is the id of the
    first when buying it fills the step. `off`: the highlight's own stage is switched off and only the
    layers need it. `buy` lists every pick once, with the steps it then serves in all the recipes.
    """
    have = [dict(paint) for paint in owned]
    known = {paint["id"] for paint in have}
    pool = [paint for paint in others if paint["id"] not in known]
    gaps, buy, settled = [], [], set()

    def step_of(recipe: dict, key: str) -> dict | None:
        return next((s for s in layers.resolve(recipe, have, profile, bottle_distance) if s["key"] == key), None)

    for grade, limit in (("missing", bottle_distance * MISSING_REACH), ("better", bottle_distance)):
        picked = []
        for recipe in recipes:
            seen = _with_blend_end(recipe)
            while True:
                steps = layers.resolve(seen, have, profile, bottle_distance)
                gap = next((g for g in _gaps(seen, steps, grade, limit) if (recipe["id"], g["key"]) not in settled), None)
                if gap is None:
                    break
                settled.add((recipe["id"], gap["key"]))
                options = _options(gap, [p for p in pool if p["id"] not in known], bottle_distance)
                pick = None
                if options:
                    pick = {k: v for k, v in options[0].items() if k != "distance"}
                    have.append(pick)
                    if _uses(step_of(seen, gap["key"]), pick["id"]):
                        known.add(pick["id"])
                        picked.append(pick)
                    else:
                        have.pop()
                        pick = None
                if pick is None and gap["reason"] != "none":
                    continue                                    # nothing to buy that would change this step
                gaps.append({
                    "recipe": recipe["id"], "key": gap["key"], "stage": gap["stage"], "index": gap["index"], "of": gap["of"],
                    "grade": "missing" if gap["reason"] == "none" else grade, "reason": gap["reason"],
                    "off": seen is not recipe and gap["key"] == "highlight", "wanted": gap["wanted"], "have": gap["have"],
                    "distance": None if gap["distance"] is None else round(gap["distance"], 4),
                    "options": options, "pick": pick["id"] if pick else None})
        for paint in picked:
            served = [{"recipe": recipe["id"], "keys": keys} for recipe in recipes
                      if (keys := [s["key"] for s in layers.resolve(recipe, have, profile, bottle_distance)
                                   if _uses(s, paint["id"])])]
            buy.append({"paint": paint, "grade": grade, "for": served})
    return {"gaps": gaps, "buy": buy}


def _with_blend_end(recipe: dict) -> dict:
    """The recipe with its highlight step shown when layers blend towards it: `resolve` leaves a switched-off
    highlight out, but layers with no lighter paint to reach for have no paint either."""
    if recipe["use"].get("highlight") or recipe["layers"] == 0:
        return recipe
    return dict(recipe, use=dict(recipe["use"], highlight=True))


def _uses(step: dict | None, paint_id: str) -> bool:
    if step is None:
        return False
    if step["paint"]:
        return step["paint"]["id"] == paint_id
    return any(part["paint"]["id"] == paint_id for part in step["mix"] or [])


def _gaps(recipe: dict, steps: list[dict], grade: str, limit: float) -> list[dict]:
    """The steps of one recipe that want a paint, the ones others depend on first."""
    tints = layers.tints(recipe)
    covering = layers.covering_formats(recipe)
    base = next(step for step in steps if step["key"] == "base")
    found = []
    for step in steps:
        if step["pinned"]:
            continue                                            # the painter's own choice
        stage, paint = step["stage"], step["paint"]
        distance = None
        if stage in tints:
            wanted, formats, measure = tints[stage]
            if paint is None:
                reason = "none"
            # A wash's bottle colour is a loose guide, and a line is dark whatever its hue: only a wash
            # of quite another colour is worth replacing.
            elif stage != "lining" and grade == "missing" and (distance := measure(wanted, paint["hex"])) > limit:
                reason = "far"
            else:
                continue
        elif stage == "layers":
            wanted, formats, measure = step["target"], covering, colour.distance
            if paint is None and step["mix"] is None:
                reason = "none"
            elif grade == "better" and recipe["mode"] == "bottles" and step["mix"] is not None:
                reason = "mix"
            else:
                continue
        else:
            wanted, formats, measure, distance = step["target"], covering, colour.distance, step["distance"]
            if paint is None:
                reason, distance = "none", None
            elif stage == "highlight" and base["paint"] and paint["id"] == base["paint"]["id"]:
                reason = "flat"
            elif distance > limit:
                reason = "far"
            else:
                continue
        found.append({"key": step["key"], "stage": stage, "index": step["index"], "of": step["of"], "reason": reason,
                      "wanted": wanted, "have": paint, "distance": distance, "formats": formats, "measure": measure})
    return sorted(found, key=lambda gap: _ORDER.index(gap["stage"]))


def _options(gap: dict, pool: list[dict], bottle_distance: float) -> list[dict]:
    """The nearest paint of each brand that is clearly nearer than what is owned, nearest first."""
    if gap["reason"] == "mix":
        bound = bottle_distance * layers.BOTTLES_REACH          # what `resolve` accepts in place of a mix
    elif gap["distance"] is not None:
        bound = gap["distance"] - bottle_distance * MARGIN
    else:
        bound = math.inf
    best: dict[str, tuple[float, dict]] = {}
    for paint in pool:
        if paint["format"] not in gap["formats"]:
            continue
        distance = gap["measure"](gap["wanted"], paint["hex"])
        if distance < bound and (paint["provider"] not in best or distance < best[paint["provider"]][0]):
            best[paint["provider"]] = (distance, paint)
    ranked = sorted(best.values(), key=lambda entry: (entry[0], entry[1]["id"]))[:BRANDS]
    return [dict(paint, distance=round(distance, 4)) for distance, paint in ranked]
