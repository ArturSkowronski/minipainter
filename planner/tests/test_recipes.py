import json

import pytest

from tests.packages import flat, spiderman
from wpm import recipes, workspace, zones
from wpm.layers import DEFAULT_BOTTLE_DISTANCE
from wpm.profiles.nomnom import scan
from wpm.workspace import Project

DEFAULTS = {"material": "", "base": "#8a8a8a", "highlight": None, "layers": 2, "mode": "auto", "metallic": False,
            "use": {"shade": True, "lining": False, "highlight": True, "ink": False},
            "lining_threshold": 0.5, "pins": {}, "notes": {}}


@pytest.fixture
def project(tmp_path):
    return Project.open_or_create(scan(flat(tmp_path / "src")))


def test_a_new_plan_has_the_painting_fields(project):
    plan = project.snapshot()
    assert plan["version"] == workspace.PLAN_VERSION == 3
    assert (plan["primer"], plan["stage_profile"], plan["recipes"], plan["recipe_seq"]) == ("#8b8e93", "layered", [], 0)
    assert plan["bottle_distance"] == DEFAULT_BOTTLE_DISTANCE
    assert all(part["progress"] == {} for part in plan["variants"][0]["parts"])


def test_defaults_and_ids_that_are_never_reused(project):
    before = project.snapshot()["revision"]
    first = recipes.create_recipe(project)
    assert first == {"id": "r1", "name": "Receptura 1", **DEFAULTS}
    assert project.snapshot()["revision"] == before + 1
    second = recipes.create_recipe(project, {"name": " Czerwień kostiumu ", "base": "#B3202A", "layers": 3})
    assert second == {"id": "r2", "name": "Czerwień kostiumu", **DEFAULTS, "base": "#b3202a", "layers": 3}
    recipes.delete_recipe(project, "r2")
    assert recipes.create_recipe(project)["id"] == "r3"
    assert [r["id"] for r in project.snapshot()["recipes"]] == ["r1", "r3"]
    assert recipes.get_recipe(project.snapshot(), "r3")["name"] == "Receptura 3"
    for call in (lambda: recipes.get_recipe(project.snapshot(), "r2"), lambda: recipes.update_recipe(project, "r2", {}),
                 lambda: recipes.delete_recipe(project, "r2")):
        with pytest.raises(KeyError):
            call()


def test_a_partial_update_keeps_the_rest(project):
    recipes.create_recipe(project, {"name": "Błękit", "base": "#2a5caa"})
    changed = recipes.update_recipe(project, "r1", {"highlight": "#6493DE", "mode": "mixes", "metallic": True,
                                                    "lining_threshold": 0.3, "material": "tkanina", "layers": 0})
    assert changed == {"id": "r1", "name": "Błękit", **DEFAULTS, "base": "#2a5caa", "highlight": "#6493de",
                       "mode": "mixes", "metallic": True, "lining_threshold": 0.3, "material": "tkanina", "layers": 0}
    assert recipes.update_recipe(project, "r1", {"highlight": None})["highlight"] is None
    assert project.snapshot()["recipes"][0]["mode"] == "mixes"


@pytest.mark.parametrize("bad", [
    {"name": "  "}, {"name": "x" * 61}, {"name": 5}, {"base": "red"}, {"base": None}, {"highlight": "#12"},
    {"layers": 7}, {"layers": -1}, {"layers": 2.5}, {"layers": True}, {"layers": "2"}, {"mode": "magic"},
    {"metallic": "yes"}, {"use": {"base": False}}, {"use": {"shade": 1}}, {"use": []},
    {"lining_threshold": 0.01}, {"lining_threshold": 1}, {"lining_threshold": "half"}, {"material": "x" * 201},
    {"notes": {"primer": "x"}}, {"notes": {"base": "x" * 501}}, {"notes": {"base": 3}},
    {"pins": {"primer": {"paint": "a"}}}, {"pins": {"layer:3/2": {"paint": "a"}}}, {"pins": {"layer:0/2": {"paint": "a"}}},
    {"pins": {"layer:1/7": {"paint": "a"}}}, {"pins": {"base": {"paint": ""}}}, {"pins": {"base": {"paint": 4}}},
    {"pins": {"base": {"paint": "a", "mix": []}}}, {"pins": {"base": {"mix": [{"paint": "a", "parts": 1}]}}},
    {"pins": {"base": {"mix": [{"paint": "a", "parts": 0}, {"paint": "b", "parts": 1}]}}},
    {"pins": {"base": {"mix": [{"paint": "a", "parts": 10}, {"paint": "b", "parts": 1}]}}},
    {"pins": {"base": {"mix": [{"paint": "a", "parts": True}, {"paint": "b", "parts": 1}]}}},
    {"pins": {"base": "a"}}, {"id": "r9"}, {"colour": "#000000"},
])
def test_bad_input_is_refused_and_changes_nothing(project, bad):
    recipes.create_recipe(project)
    before = project.snapshot()
    with pytest.raises(ValueError):
        recipes.update_recipe(project, "r1", bad)
    with pytest.raises(ValueError):
        recipes.create_recipe(project, bad)
    assert project.snapshot() == before


def test_use_notes_and_pins_merge_and_unset(project):
    recipes.create_recipe(project)
    r = recipes.update_recipe(project, "r1", {"use": {"lining": True}, "notes": {"base": " dwie warstwy ", "shade": "x"},
                                              "pins": {"base": {"paint": "citadel/mephiston-red"}}})
    assert r["use"] == {"shade": True, "lining": True, "highlight": True, "ink": False}
    assert r["notes"] == {"base": "dwie warstwy", "shade": "x"}
    mix = {"mix": [{"paint": "a", "parts": 2}, {"paint": "b", "parts": 1}]}
    r = recipes.update_recipe(project, "r1", {"use": {"shade": False}, "notes": {"shade": "  "},
                                              "pins": {"layer:1/2": mix, "base": None, "ink": None}})
    assert r["use"] == {"shade": False, "lining": True, "highlight": True, "ink": False}
    assert r["notes"] == {"base": "dwie warstwy"} and r["pins"] == {"layer:1/2": mix}


def test_deleting_a_recipe_unlinks_zones_and_drops_its_marks(tmp_path):
    project = Project.open_or_create(scan(spiderman(tmp_path / "src")))
    recipes.create_recipe(project)
    recipes.create_recipe(project)
    for variant, part in (("1-10-scale-split", "body"), ("bust", "bust-torso")):
        zones.create_zone(project, variant, part)
        zones.create_zone(project, variant, part)
        assert zones.update_zone(project, variant, part, 1, recipe="r1")["recipe"] == "r1"
        zones.update_zone(project, variant, part, 2, recipe="r2")
        recipes.set_progress(project, variant, part, "r1", "base", True)
        recipes.set_progress(project, variant, part, "r2", "base", True)
    recipes.delete_recipe(project, "r1")
    for variant, part in (("1-10-scale-split", "body"), ("bust", "bust-torso")):
        entry = project.part(variant, part)
        assert [z["recipe"] for z in entry["zones"]] == [None, "r2"]
        assert entry["progress"] == {"r2": ["base"]}
        assert [z["name"] for z in entry["zones"]] == ["Strefa 1", "Strefa 2"]


def test_linking_a_zone(project):
    recipes.create_recipe(project)
    zones.create_zone(project, "src", "a")
    assert project.part("src", "a")["zones"][0]["recipe"] is None
    assert zones.update_zone(project, "src", "a", 1, recipe="r1")["recipe"] == "r1"
    assert zones.update_zone(project, "src", "a", 1, name="Pas")["recipe"] == "r1"       # untouched when not given
    assert zones.update_zone(project, "src", "a", 1, recipe=None)["recipe"] is None
    before = project.snapshot()
    with pytest.raises(ValueError):
        zones.update_zone(project, "src", "a", 1, recipe="r7")
    assert project.snapshot() == before


def test_progress_marks(project):
    recipes.create_recipe(project)
    assert recipes.set_progress(project, "src", "a", "r1", "shade", True) == {"r1": ["shade"]}
    assert recipes.set_progress(project, "src", "a", "r1", "base", True) == {"r1": ["base", "shade"]}
    revision = project.snapshot()["revision"]
    assert recipes.set_progress(project, "src", "a", "r1", "base", True) == {"r1": ["base", "shade"]}
    assert recipes.set_progress(project, "src", "a", "r1", "layer:2", True) == {"r1": ["base", "layer:2", "shade"]}
    assert recipes.set_progress(project, "src", "a", "r1", "base", False) == {"r1": ["layer:2", "shade"]}
    assert recipes.set_progress(project, "src", "a", "r1", "base", False) == {"r1": ["layer:2", "shade"]}
    recipes.set_progress(project, "src", "a", "r1", "layer:2", False)
    assert recipes.set_progress(project, "src", "a", "r1", "shade", False) == {}
    assert project.part("src", "b")["progress"] == {} and project.snapshot()["revision"] > revision
    for step in ("primer", "layer:0", "layer:7", "layer:x", "", None):
        with pytest.raises(ValueError):
            recipes.set_progress(project, "src", "a", "r1", step, True)
    with pytest.raises(ValueError):
        recipes.set_progress(project, "src", "a", "r1", "base", "yes")
    for where in (("src", "a", "r9"), ("src", "nope", "r1"), ("nope", "a", "r1")):
        with pytest.raises(KeyError):
            recipes.set_progress(project, *where, "base", True)


def test_settings(project):
    assert recipes.update_settings(project, {"primer": "#101010"}) == {
        "primer": "#101010", "bottle_distance": DEFAULT_BOTTLE_DISTANCE}
    assert recipes.update_settings(project, {"bottle_distance": 0.1})["bottle_distance"] == 0.1
    assert project.snapshot()["primer"] == "#101010"
    before = project.snapshot()
    for bad in ({"primer": "black"}, {"bottle_distance": -0.1}, {"bottle_distance": 0.6},
                {"bottle_distance": True}, {"stage_profile": "zenithal"}):
        with pytest.raises(ValueError):
            recipes.update_settings(project, bad)
    assert project.snapshot() == before


def test_version_2_plans_gain_the_painting_fields(project):
    zones.create_zone(project, "src", "a")
    path = project.dir / "plan.json"
    old = json.loads(path.read_text())
    old["version"] = 2
    for key in ("primer", "stage_profile", "bottle_distance", "recipes", "recipe_seq"):
        del old[key]
    for part in old["variants"][0]["parts"]:
        del part["progress"]
        for zone in part["zones"]:
            del zone["recipe"]
    path.write_text(json.dumps(old))
    workspace._projects.clear()
    plan = Project.load(project.slug).snapshot()
    assert plan["version"] == 3 and plan["recipes"] == [] and plan["recipe_seq"] == 0
    assert plan["primer"] == "#8b8e93" and plan["stage_profile"] == "layered"
    assert plan["bottle_distance"] == DEFAULT_BOTTLE_DISTANCE
    assert all(part["progress"] == {} for part in plan["variants"][0]["parts"])
    assert plan["variants"][0]["parts"][0]["zones"] == [
        {"id": 1, "name": "Strefa 1", "color": zones.PALETTE[0], "recipe": None}]
    assert json.loads(path.read_text())["version"] == 3
