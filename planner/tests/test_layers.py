import pytest

from wpm import colour, layers

RED, LIGHT, BLUE = "#b3202a", "#e8705a", "#2a5caa"


def paint(pid, fmt, hex_):
    return {"id": pid, "name": pid.replace("-", " ").title(), "provider": "test", "format": fmt, "hex": hex_}


MID = paint("mid-red", "opaque_layer", colour.mix(RED, LIGHT, 0.5))
PAINTS = [
    paint("dark-red", "opaque_base", "#8a1c1c"), paint("red", "opaque_base", RED),
    paint("light-red", "opaque_layer", LIGHT), paint("blue", "opaque_base", BLUE),
    paint("grey", "opaque_base", "#808080"),
    paint("red-wash", "wash", "#5a1a1a"), paint("black-wash", "wash", "#1a1a1a"),
    paint("red-contrast", "contrast", "#a82a2a"), paint("green-ink", "ink", "#007033"),
    paint("silver", "metallic", "#9c9e9e"), paint("gold", "metallic", "#d1a965"),
]


def recipe(**changes):
    r = {"base": RED, "highlight": LIGHT, "layers": 2, "mode": "auto", "metallic": False,
         "use": {"shade": True, "lining": False, "highlight": True, "ink": False},
         "lining_threshold": 0.5, "pins": {}, "notes": {}}
    r.update(changes)
    return r


def steps(paints=PAINTS, distance=layers.DEFAULT_BOTTLE_DISTANCE, **changes):
    return {s["key"]: s for s in layers.resolve(recipe(**changes), paints, bottle_distance=distance)}


def ids(step):
    if step["mix"]:
        return [(m["paint"]["id"], m["parts"]) for m in step["mix"]]
    return step["paint"] and step["paint"]["id"]


def test_the_profile_and_its_limits():
    assert layers.STAGE_PROFILES["layered"]["stages"] == [
        "primer", "base", "layers", "shade", "lining", "highlight", "ink"]
    assert layers.DEFAULT_PROFILE == "layered" and layers.MAX_LAYERS == 6
    assert layers.MODES == ("auto", "bottles", "mixes")
    assert layers.OPTIONAL == ("shade", "lining", "highlight", "ink")
    assert 0 < layers.DEFAULT_BOTTLE_DISTANCE < 0.2


def test_base_and_highlight_take_the_nearest_covering_paint():
    s = steps()
    assert ids(s["base"]) == "red" and s["base"]["color"] == RED and s["base"]["distance"] == 0
    assert ids(s["highlight"]) == "light-red" and s["highlight"]["target"] == LIGHT
    # A wash is nearer to this colour than any covering paint, and still not chosen.
    near_wash = steps(base="#5c1b1b")["base"]
    assert ids(near_wash) == "dark-red" and near_wash["target"] == "#5c1b1b"
    assert near_wash["distance"] == pytest.approx(colour.distance("#5c1b1b", "#8a1c1c"))
    assert near_wash["pinned"] is False and near_wash["stale_pin"] is None


def test_a_metallic_recipe_gets_metallics_only():
    s = steps(metallic=True, base="#a0a0a0", highlight=None, layers=2, mode="bottles")
    used = [s[k]["paint"] for k in ("base", "highlight", "layer:1", "layer:2") if s[k]["paint"]]
    used += [m["paint"] for k in ("layer:1", "layer:2") for m in s[k]["mix"] or []]
    assert used and all(p["format"] == "metallic" for p in used)
    assert ids(s["base"]) == "silver"


def test_layer_steps_follow_the_count():
    assert [k for k in steps(layers=0) if k.startswith("layer")] == []
    three = steps(layers=3)
    assert [k for k in three if k.startswith("layer")] == ["layer:1", "layer:2", "layer:3"]
    assert [(three[f"layer:{k}"]["index"], three[f"layer:{k}"]["of"]) for k in (1, 2, 3)] == [(1, 3), (2, 3), (3, 3)]
    assert three["layer:2"]["stage"] == "layers" and three["base"]["index"] is None


def test_order_follows_the_profile_and_unused_stages_are_absent():
    everything = {"shade": True, "lining": True, "highlight": True, "ink": True}
    r = recipe(layers=1, use=everything)
    assert [s["key"] for s in layers.resolve(r, PAINTS)] == ["base", "layer:1", "shade", "lining", "highlight", "ink"]
    assert layers.step_keys(r) == ["base", "layer:1", "shade", "lining", "highlight", "ink"]
    nothing = recipe(layers=0, use={"shade": False, "lining": False, "highlight": False, "ink": False})
    assert layers.step_keys(nothing) == ["base"] == [s["key"] for s in layers.resolve(nothing, PAINTS)]


def test_mix_ratios_are_simple_parts():
    one = steps(mode="mixes", layers=1)["layer:1"]
    assert ids(one) == [("red", 1), ("light-red", 1)] and one["paint"] is None
    assert one["color"] == colour.mix(RED, LIGHT, 0.5) and one["target"] == colour.mix(RED, LIGHT, 0.5)
    two = steps(mode="mixes", layers=2)
    assert [ids(two[k]) for k in ("layer:1", "layer:2")] == [
        [("red", 2), ("light-red", 1)], [("red", 1), ("light-red", 2)]]
    assert two["layer:1"]["color"] == colour.mix(RED, LIGHT, 1 / 3)
    six = steps(mode="mixes", layers=6)
    assert [tuple(m["parts"] for m in six[f"layer:{k}"]["mix"]) for k in range(1, 7)] == [
        (4, 1), (3, 1), (3, 2), (2, 3), (1, 3), (1, 4)]
    assert six["layer:1"]["color"] == colour.mix(RED, LIGHT, 1 / 5)
    assert six["layer:1"]["target"] == colour.mix(RED, LIGHT, 1 / 7)
    assert six["layer:1"]["distance"] == pytest.approx(colour.distance(six["layer:1"]["target"], six["layer:1"]["color"]))


def test_auto_takes_a_bottle_only_when_it_is_close():
    with_mid = PAINTS + [MID]
    assert ids(steps(with_mid, layers=1)["layer:1"]) == "mid-red"
    assert steps(with_mid, layers=1)["layer:1"]["mix"] is None
    assert ids(steps(with_mid, distance=0, layers=1)["layer:1"]) == [("red", 1), ("light-red", 1)]
    assert ids(steps(with_mid, mode="mixes", layers=1)["layer:1"]) == [("red", 1), ("light-red", 1)]


def place(step):
    """Where a layer sits between base (0) and highlight (1): a mix by its parts, a bottle by its colour."""
    if step["mix"]:
        first, second = step["mix"]
        return second["parts"] / (first["parts"] + second["parts"])
    base, light, here = (colour.to_oklab(c) for c in (RED, LIGHT, step["paint"]["hex"]))
    along = [h - b for b, h in zip(base, light)]
    return sum((x - b) * a for x, b, a in zip(here, base, along)) / sum(a * a for a in along)


def test_a_bottle_is_used_only_for_the_layer_whose_place_it_has():
    # A paint from the middle of the blend is layer 2, never layer 1 or 3, though it is the nearest bottle to all.
    assert colour.distance(colour.mix(RED, LIGHT, 0.25), MID["hex"]) < 2 * layers.DEFAULT_BOTTLE_DISTANCE    # in reach
    s = steps(PAINTS + [MID], layers=3, mode="bottles")
    assert [ids(s[f"layer:{k}"]) for k in (1, 2, 3)] == [
        [("red", 3), ("light-red", 1)], "mid-red", [("red", 1), ("light-red", 3)]]


def test_layers_never_step_back_towards_the_base():
    # Nearest-bottle-first once gave a lighter layer under a darker one.
    for share in (0.3, 0.45, 0.55, 0.7, 0.9):
        paints = PAINTS + [paint("somewhere", "opaque_layer", colour.mix(RED, LIGHT, share))]
        for count in range(1, 7):
            for mode in ("auto", "bottles"):
                s = steps(paints, distance=5, layers=count, mode=mode)
                places = [place(s[f"layer:{k}"]) for k in range(1, count + 1)]
                assert places == sorted(places), (share, count, mode, places)
                assert len({str(ids(s[f"layer:{k}"])) for k in range(1, count + 1)}) == count


def test_bottles_mode_reaches_further_than_auto():
    off_target = paint("off-red", "opaque_layer", colour.mix(RED, LIGHT, 0.65))
    gap = colour.distance(colour.mix(RED, LIGHT, 0.5), off_target["hex"])
    assert gap > 0
    paints = PAINTS + [off_target]
    assert ids(steps(paints, distance=gap * 0.6, layers=1)["layer:1"]) == [("red", 1), ("light-red", 1)]
    assert ids(steps(paints, distance=gap * 0.6, layers=1, mode="bottles")["layer:1"]) == "off-red"


def test_pins_are_honoured():
    s = steps(layers=1, pins={"base": {"paint": "dark-red"}, "shade": {"paint": "green-ink"},
                              "layer:1/1": {"mix": [{"paint": "red", "parts": 3}, {"paint": "blue", "parts": 1}]},
                              "layer:1/2": {"paint": "grey"}})
    assert ids(s["base"]) == "dark-red" and s["base"]["pinned"] is True and s["base"]["target"] == RED
    assert ids(s["layer:1"]) == [("red", 3), ("blue", 1)] and s["layer:1"]["pinned"] is True
    assert s["layer:1"]["color"] == colour.mix(RED, BLUE, 0.25)
    # Layers are spaced from the paint that is really underneath.
    assert s["layer:1"]["target"] == colour.mix("#8a1c1c", LIGHT, 0.5)
    assert ids(s["shade"]) == "green-ink" and s["shade"]["pinned"] is True
    assert s["highlight"]["pinned"] is False
    pinned_bottle = steps(layers=2, pins={"layer:1/2": {"paint": "grey"}})
    assert ids(pinned_bottle["layer:1"]) == "grey" and pinned_bottle["layer:2"]["pinned"] is False


def test_a_stale_pin_falls_back_and_is_named():
    s = steps(layers=1, pins={"base": {"paint": "sold"},
                              "layer:1/1": {"mix": [{"paint": "red", "parts": 1}, {"paint": "sold", "parts": 1}]}})
    assert ids(s["base"]) == "red" and s["base"]["pinned"] is False and s["base"]["stale_pin"] == "sold"
    assert ids(s["layer:1"]) == [("red", 1), ("light-red", 1)] and s["layer:1"]["stale_pin"] == "sold"


def test_shade_lining_and_ink_defaults():
    red = steps(use={"shade": True, "lining": True, "highlight": True, "ink": True})
    assert ids(red["shade"]) == "red-wash" and red["shade"]["target"] is None and red["shade"]["distance"] is None
    assert red["shade"]["color"] == "#5a1a1a"
    assert ids(red["lining"]) == "black-wash" and red["lining"]["threshold"] == 0.5
    assert red["shade"]["threshold"] is None
    assert ids(red["ink"]) == "red-contrast"
    assert ids(steps(base="#808080", highlight=None)["shade"]) == "black-wash"
    assert steps(lining_threshold=0.3, use={"shade": False, "lining": True, "highlight": False, "ink": False})[
        "lining"]["threshold"] == 0.3


def test_missing_kinds_leave_the_step_without_a_paint():
    no_wash = [p for p in PAINTS if p["format"] != "wash"]
    shade = steps(no_wash)["shade"]
    assert shade["paint"] is None and shade["color"] == colour.darken(RED)
    no_tints = [p for p in PAINTS if p["format"] not in ("ink", "contrast")]
    ink = steps(no_tints, use={"shade": False, "lining": False, "highlight": False, "ink": True})["ink"]
    assert ink["paint"] is None and ink["color"] == RED
    assert steps([p for p in PAINTS if p["format"] != "metallic"], metallic=True)["base"]["paint"] is None


def test_an_empty_inventory_still_gives_evenly_spaced_colours():
    s = steps([], layers=2, use={"shade": True, "lining": True, "highlight": True, "ink": True})
    assert all(step["paint"] is None and step["mix"] is None for step in s.values())
    assert s["base"]["color"] == RED and s["highlight"]["color"] == LIGHT
    assert [s[k]["color"] for k in ("layer:1", "layer:2")] == [colour.mix(RED, LIGHT, 1 / 3), colour.mix(RED, LIGHT, 2 / 3)]
    assert s["base"]["distance"] == 0


def test_base_and_highlight_on_one_paint_leave_layers_without_paint():
    only_red = [p for p in PAINTS if p["id"] in ("red", "red-wash")]
    s = steps(only_red, layers=2, mode="mixes")
    assert ids(s["base"]) == ids(s["highlight"]) == "red"
    assert all(s[k]["paint"] is None and s[k]["mix"] is None and s[k]["color"] == RED for k in ("layer:1", "layer:2"))
    assert s["highlight"]["distance"] == pytest.approx(colour.distance(LIGHT, RED))


def test_no_highlight_colour_means_a_lightened_base():
    s = steps(highlight=None)
    assert s["highlight"]["target"] == colour.lighten(RED)
    hidden = steps(highlight=None, layers=1, mode="mixes", use={"shade": False, "lining": False,
                                                                 "highlight": False, "ink": False})
    assert "highlight" not in hidden and ids(hidden["layer:1"])[1][0] == ids(s["highlight"])


def test_notes_come_through_per_stage():
    s = steps(notes={"base": "dwie cienkie warstwy", "layers": "rozcieńcz", "shade": "tylko zagłębienia"})
    assert s["base"]["note"] == "dwie cienkie warstwy" and s["shade"]["note"] == "tylko zagłębienia"
    assert s["layer:1"]["note"] == s["layer:2"]["note"] == "rozcieńcz" and s["highlight"]["note"] == ""
