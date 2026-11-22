from wpm import shopping
from wpm.colour import distance, lighten


def paint(id, hex, format="opaque_layer"):
    return {"id": id, "name": id.split("/")[1].replace("-", " ").title(), "provider": id.split("/")[0], "format": format,
            "hex": hex}


def recipe(id="r1", base="#2a5caa", **fields):
    made = {"id": id, "name": id, "material": "", "base": base, "highlight": None, "layers": 2, "mode": "auto",
            "metallic": False, "use": {"shade": False, "lining": False, "highlight": True, "ink": False},
            "lining_threshold": 0.5, "pins": {}, "notes": {}}
    made.update(fields)
    return made


BLUE = "#2a5caa"
LIGHT_BLUE = lighten(BLUE)
TEAL = paint("ak/teal", "#2b84a2", "opaque_base")                 # the only blue owned: far from both colours
DEEP = paint("citadel/deep-blue", "#3a5aa8")                       # catalogue paints near the base...
ROYAL = paint("army/royal-blue", "#2a64a8")
NAVY = paint("vallejo/navy", "#2a4e9e")
DEEPER = paint("citadel/deeper-blue", "#2a5cab")                   # nearer than DEEP, same brand
SKY = paint("army/sky", LIGHT_BLUE)                                # ...and one at the highlight
CATALOGUE = [DEEP, ROYAL, NAVY, SKY, paint("citadel/blue-wash", BLUE, "wash"),
             paint("citadel/blue-technical", BLUE, "technical"), paint("vallejo/blue-metal", BLUE, "metallic")]


def by_key(result, recipe_id="r1"):
    return {gap["key"]: gap for gap in result["gaps"] if gap["recipe"] == recipe_id}


def test_nothing_is_missing_when_every_step_has_a_paint_close_to_its_colour():
    owned = [paint("o/base", BLUE, "opaque_base"), paint("o/light", LIGHT_BLUE)]
    assert shopping.recommend([recipe()], owned, CATALOGUE) == {"gaps": [], "buy": []}


def test_a_colour_far_from_every_owned_paint_gets_the_nearest_paints_of_the_catalogue_one_per_brand():
    result = shopping.recommend([recipe(layers=0, use={"highlight": False})], [TEAL], CATALOGUE + [DEEPER])
    gap = by_key(result)["base"]
    assert gap["reason"] == "far" and gap["grade"] == "missing" and gap["stage"] == "base"
    assert gap["wanted"] == BLUE and gap["have"]["id"] == "ak/teal" and gap["distance"] > 0.08
    # Covering paints only, nearest first, the best of each brand.
    assert [option["id"] for option in gap["options"]] == ["citadel/deeper-blue", "army/royal-blue", "vallejo/navy"]
    assert gap["options"][0]["distance"] == round(distance(BLUE, DEEPER["hex"]), 4)
    assert gap["pick"] == "citadel/deeper-blue"
    assert result["buy"] == [{"paint": DEEPER, "grade": "missing", "for": [{"recipe": "r1", "keys": ["base"]}]}]


def test_a_highlight_that_is_the_base_paint_again_is_missing_and_buying_it_gives_the_layers():
    owned = [paint("o/base", BLUE, "opaque_base")]
    result = shopping.recommend([recipe()], owned, CATALOGUE)
    gaps = by_key(result)
    assert list(gaps) == ["highlight"]                         # the layers are not asked for one by one
    assert gaps["highlight"]["reason"] == "flat" and gaps["highlight"]["have"]["id"] == "o/base"
    assert gaps["highlight"]["wanted"] == LIGHT_BLUE and gaps["highlight"]["pick"] == "army/sky"
    assert result["buy"] == [{"paint": SKY, "grade": "missing",
                              "for": [{"recipe": "r1", "keys": ["layer:1", "layer:2", "highlight"]}]}]


def test_layers_need_the_highlight_even_when_its_stage_is_switched_off():
    owned = [paint("o/base", BLUE, "opaque_base")]
    result = shopping.recommend([recipe(use={"highlight": False})], owned, CATALOGUE)
    gap = by_key(result)["highlight"]
    assert gap["off"] is True and gap["pick"] == "army/sky"
    assert result["buy"][0]["for"] == [{"recipe": "r1", "keys": ["layer:1", "layer:2"]}]
    # Without layers a switched-off highlight is nobody's business.
    assert shopping.recommend([recipe(layers=0, use={"highlight": False})], owned, CATALOGUE)["gaps"] == []


def test_a_paint_only_roughly_right_is_a_weaker_proposal():
    near = paint("o/near", "#3668a0", "opaque_base")           # between one and two bottle distances from the base
    assert 0.04 < distance(BLUE, near["hex"]) < 0.08
    result = shopping.recommend([recipe(layers=0, use={"highlight": False})], [near], CATALOGUE)
    gap = by_key(result)["base"]
    assert gap["grade"] == "better" and gap["reason"] == "far" and gap["have"]["id"] == "o/near"
    assert result["buy"][0]["grade"] == "better"


def test_no_proposal_when_the_catalogue_has_nothing_clearly_nearer():
    barely = paint("x/barely", "#3668a2")                      # hardly nearer than what is owned
    result = shopping.recommend([recipe(layers=0, use={"highlight": False})], [paint("o/near", "#3668a0", "opaque_base")],
                                [barely])
    assert result == {"gaps": [], "buy": []}
    assert shopping.recommend([recipe(layers=0, use={"highlight": False})], [TEAL], []) == {"gaps": [], "buy": []}


def test_a_step_with_no_paint_at_all_is_reported_even_if_the_catalogue_cannot_help():
    lone = recipe(layers=0, use={"highlight": False})
    gap = by_key(shopping.recommend([lone], [], []))["base"]
    assert gap["reason"] == "none" and gap["have"] is None and gap["options"] == [] and gap["pick"] is None
    assert shopping.recommend([lone], [], [])["buy"] == []
    assert by_key(shopping.recommend([lone], [], CATALOGUE))["base"]["pick"] == "citadel/deep-blue"


def test_a_pinned_step_is_the_painters_choice_not_a_gap():
    pinned = recipe(layers=0, use={"highlight": False}, pins={"base": {"paint": "ak/teal"}})
    assert shopping.recommend([pinned], [TEAL], CATALOGUE) == {"gaps": [], "buy": []}


def test_a_metallic_recipe_is_offered_metallic_paints_only():
    result = shopping.recommend([recipe(layers=0, metallic=True, use={"highlight": False})], [TEAL], CATALOGUE)
    gap = by_key(result)["base"]
    assert gap["reason"] == "none" and [option["id"] for option in gap["options"]] == ["vallejo/blue-metal"]


def test_a_missing_wash_is_proposed_from_the_washes():
    owned = [paint("o/base", BLUE, "opaque_base")]
    shaded = recipe(layers=0, use={"shade": True, "highlight": False})
    gap = by_key(shopping.recommend([shaded], owned, CATALOGUE))["shade"]
    assert gap["reason"] == "none" and [option["id"] for option in gap["options"]] == ["citadel/blue-wash"]
    # A wash of quite another colour is a gap as well, a wash of roughly the colour is not.
    red_wash = paint("o/red-wash", "#5a1a1a", "wash")
    gap = by_key(shopping.recommend([shaded], owned + [red_wash], CATALOGUE))["shade"]
    assert gap["reason"] == "far" and gap["have"]["id"] == "o/red-wash" and gap["pick"] == "citadel/blue-wash"
    dark_blue_wash = paint("o/blue-tone", "#1a2a5a", "wash")
    assert shopping.recommend([shaded], owned + [dark_blue_wash], CATALOGUE)["gaps"] == []


def test_lining_is_only_missing_when_no_wash_is_owned():
    lined = recipe(layers=0, use={"lining": True, "highlight": False})
    owned = [paint("o/base", BLUE, "opaque_base")]
    assert by_key(shopping.recommend([lined], owned, CATALOGUE))["lining"]["reason"] == "none"
    assert shopping.recommend([lined], owned + [paint("o/red-wash", "#5a1a1a", "wash")], CATALOGUE)["gaps"] == []


def test_one_bottle_bought_for_one_recipe_serves_the_next():
    first, second = recipe("r1", layers=0, use={"highlight": False}), recipe("r2", layers=0, use={"highlight": False})
    result = shopping.recommend([first, second], [TEAL], CATALOGUE)
    assert [gap["recipe"] for gap in result["gaps"]] == ["r1"]
    assert result["buy"] == [{"paint": DEEP, "grade": "missing",
                              "for": [{"recipe": "r1", "keys": ["base"]}, {"recipe": "r2", "keys": ["base"]}]}]


def test_what_must_be_bought_comes_before_what_would_be_nicer():
    rough = recipe("r1", base="#3668a0", layers=0, use={"highlight": False})        # owned paint roughly right
    lost = recipe("r2", base="#b3202a", layers=0, use={"highlight": False})         # nothing red owned
    red = paint("citadel/red", "#b3202a")
    result = shopping.recommend([rough, lost], [paint("o/near", BLUE, "opaque_base")], [red, paint("army/exact", "#3668a0")])
    assert [(entry["paint"]["id"], entry["grade"]) for entry in result["buy"]] == [("citadel/red", "missing"),
                                                                                  ("army/exact", "better")]


def test_preferring_bottles_proposes_a_bottle_for_a_layer_that_is_mixed():
    owned = [paint("o/base", BLUE, "opaque_base"), paint("o/light", LIGHT_BLUE)]
    one_layer = recipe(layers=1)
    from wpm.colour import mix
    middle = paint("army/middle", mix(BLUE, LIGHT_BLUE, 0.5))
    assert shopping.recommend([one_layer], owned, [middle]) == {"gaps": [], "buy": []}       # mixing is fine by default
    result = shopping.recommend([dict(one_layer, mode="bottles")], owned, [middle])
    gap = by_key(result)["layer:1"]
    assert gap["reason"] == "mix" and gap["grade"] == "better" and gap["index"] == 1 and gap["of"] == 1
    assert gap["have"] is None and gap["pick"] == "army/middle"
    assert result["buy"][0]["for"] == [{"recipe": "r1", "keys": ["layer:1"]}]
