"""Recipes: how one kind of surface is painted, written once for the figure and used by any zone.

Also what else version 3 of the plan holds about painting: which steps are done on which part, and the
figure-wide settings. Functions raise KeyError for an unknown recipe, variant or part and ValueError
(with a reason) for bad input; on either, the plan is left exactly as it was.
"""
import copy
import re

from wpm.colour import clean_hex
from wpm.layers import MAX_LAYERS, MODES, OPTIONAL
from wpm.workspace import Project, find_part

NOTE_STAGES = ("base", "layers", "shade", "lining", "highlight", "ink")
_PIN_KEY = re.compile(r"base|highlight|shade|lining|ink|layer:([1-6])/([1-6])")
_STEP_KEY = re.compile(r"base|shade|lining|highlight|ink|layer:[1-6]")
_STEP_ORDER = ["base", *(f"layer:{k}" for k in range(1, MAX_LAYERS + 1)), "shade", "lining", "highlight", "ink"]


def _defaults(number: int) -> dict:
    return {"id": f"r{number}", "name": f"Receptura {number}", "material": "", "base": "#8a8a8a", "highlight": None,
            "layers": 2, "mode": "auto", "metallic": False,
            "use": {"shade": True, "lining": False, "highlight": True, "ink": False},
            "lining_threshold": 0.5, "pins": {}, "notes": {}}


def _text(value, limit: int, what: str, least: int = 0) -> str:
    if not isinstance(value, str) or not least <= len(value.strip()) <= limit:
        raise ValueError(f"{what} is text of {least} to {limit} characters")
    return value.strip()


def _number(value, low: float, high: float, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
        raise ValueError(f"{what} is a number from {low} to {high}")
    return value


def _paint_id(value) -> str:
    return _text(value, 100, "a paint id", least=1)


def _pin(value) -> dict:
    if isinstance(value, dict) and set(value) == {"paint"}:
        return {"paint": _paint_id(value["paint"])}
    if isinstance(value, dict) and set(value) == {"mix"}:
        parts = value["mix"]
        if isinstance(parts, list) and len(parts) == 2 and all(isinstance(m, dict) and set(m) == {"paint", "parts"} for m in parts):
            if all(isinstance(m["parts"], int) and not isinstance(m["parts"], bool) and 1 <= m["parts"] <= 9 for m in parts):
                return {"mix": [{"paint": _paint_id(m["paint"]), "parts": m["parts"]} for m in parts]}
    raise ValueError('a pin is {"paint": id} or {"mix": [two of {"paint": id, "parts": 1 to 9}]}')


def _merged(recipe: dict, changes: dict) -> dict:
    """A copy of `recipe` with `changes` applied, or ValueError. `use`, `notes` and `pins` merge key by key."""
    if not isinstance(changes, dict):
        raise ValueError("a recipe is given as an object")
    out = copy.deepcopy(recipe)
    for key, value in changes.items():
        if key == "name":
            out[key] = _text(value, 60, "a recipe name", least=1)
        elif key == "material":
            out[key] = _text(value, 200, "the material note")
        elif key == "base":
            out[key] = clean_hex(value)
        elif key == "highlight":
            out[key] = None if value is None else clean_hex(value)
        elif key == "layers":
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_LAYERS:
                raise ValueError(f"layers is a whole number from 0 to {MAX_LAYERS}")
            out[key] = value
        elif key == "mode":
            if value not in MODES:
                raise ValueError(f"mode is one of {', '.join(MODES)}")
            out[key] = value
        elif key == "metallic":
            if not isinstance(value, bool):
                raise ValueError("metallic is true or false")
            out[key] = value
        elif key == "lining_threshold":
            out[key] = _number(value, 0.05, 0.95, "lining_threshold")
        elif key == "use":
            if not isinstance(value, dict) or any(k not in OPTIONAL or not isinstance(v, bool) for k, v in value.items()):
                raise ValueError(f"use switches {', '.join(OPTIONAL)} on or off")
            out[key].update(value)
        elif key == "notes":
            if not isinstance(value, dict) or any(k not in NOTE_STAGES for k in value):
                raise ValueError(f"notes are per stage: {', '.join(NOTE_STAGES)}")
            for stage, note in value.items():
                note = _text(note, 500, "a note")
                if note:
                    out[key][stage] = note
                else:
                    out[key].pop(stage, None)
        elif key == "pins":
            if not isinstance(value, dict):
                raise ValueError("pins are per step")
            for step, pin in value.items():
                match = _PIN_KEY.fullmatch(step) if isinstance(step, str) else None
                if not match or (match.group(1) and int(match.group(1)) > int(match.group(2))):
                    raise ValueError("a pin belongs to base, highlight, shade, lining, ink or layer:<k>/<n>")
                if pin is None:
                    out[key].pop(step, None)
                else:
                    out[key][step] = _pin(pin)
        else:
            raise ValueError(f"a recipe has no field {key!r}")
    return out


def get_recipe(plan: dict, recipe_id: str) -> dict:
    """The live recipe entry inside a plan. KeyError when unknown."""
    for recipe in plan["recipes"]:
        if recipe["id"] == recipe_id:
            return recipe
    raise KeyError(recipe_id)


def create_recipe(project: Project, fields: dict | None = None) -> dict:
    made = {}

    def apply(plan: dict) -> None:
        recipe = _merged(_defaults(plan["recipe_seq"] + 1), fields or {})
        plan["recipe_seq"] += 1                    # ids are never reused: progress marks and zones name them
        plan["recipes"].append(recipe)
        made.update(copy.deepcopy(recipe))

    project.update(apply)
    return made


def update_recipe(project: Project, recipe_id: str, changes: dict) -> dict:
    made = {}

    def apply(plan: dict) -> None:
        current = get_recipe(plan, recipe_id)
        merged = _merged(current, changes)
        current.clear()
        current.update(merged)
        made.update(copy.deepcopy(merged))

    project.update(apply)
    return made


def delete_recipe(project: Project, recipe_id: str) -> None:
    """Remove the recipe; zones that used it have none, and the marks of its steps go."""
    def apply(plan: dict) -> None:
        plan["recipes"].remove(get_recipe(plan, recipe_id))
        for variant in plan["variants"]:
            for part in variant["parts"]:
                part["progress"].pop(recipe_id, None)
                for zone in part["zones"]:
                    if zone["recipe"] == recipe_id:
                        zone["recipe"] = None

    project.update(apply)


def set_progress(project: Project, variant_id: str, part_id: str, recipe_id: str, step: str, done: bool) -> dict:
    """Mark one step of a recipe done (or not) on one part. Returns the part's marks."""
    if not isinstance(step, str) or not _STEP_KEY.fullmatch(step):
        raise ValueError("a step is base, layer:<1-6>, shade, lining, highlight or ink")
    if not isinstance(done, bool):
        raise ValueError("done is true or false")
    result = {}

    def apply(plan: dict) -> None:
        part = find_part(plan, variant_id, part_id)
        get_recipe(plan, recipe_id)
        marks = set(part["progress"].get(recipe_id, []))
        marks.add(step) if done else marks.discard(step)
        if marks:
            part["progress"][recipe_id] = sorted(marks, key=_STEP_ORDER.index)
        else:
            part["progress"].pop(recipe_id, None)
        result.update(copy.deepcopy(part["progress"]))

    project.update(apply)
    return result


def update_settings(project: Project, changes: dict) -> dict:
    """Figure-wide painting settings: `primer` colour, `bottle_distance` (see wpm.layers)."""
    if not isinstance(changes, dict):
        raise ValueError("settings are given as an object")
    clean = {}
    for key, value in changes.items():
        if key == "primer":
            clean[key] = clean_hex(value)
        elif key == "bottle_distance":
            clean[key] = _number(value, 0, 0.5, "bottle_distance")
        else:
            raise ValueError(f"there is no setting {key!r}")
    project.update(lambda plan: plan.update(clean))
    plan = project.snapshot()
    return {"primer": plan["primer"], "bottle_distance": plan["bottle_distance"]}
