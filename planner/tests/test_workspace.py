import json
import shutil

import pytest

from tests.meshes import cube, write_binary_stl
from tests.packages import flat, spiderman
from wpm import workspace
from wpm.profiles.nomnom import scan
from wpm.workspace import Project, find_outliers, get_project, list_projects


def test_create_writes_a_plan_inside_the_data_dir(tmp_path):
    root = spiderman(tmp_path / "src")
    p = Project.open_or_create(scan(root))
    plan = p.snapshot()
    assert p.dir == tmp_path / "data" / "projects" / p.slug and (p.dir / "plan.json").exists()
    assert plan["revision"] == 1 and plan["active_variant"] is None
    assert plan["variants"][0]["parts"][0] | {"source": None, "size": None} == {
        "id": "body", "name": "body", "source": None, "size": None, "status": "pending", "error": None,
        "outlier": False, "mesh": "meshes/1-10-scale-split/body.glb",
        "mesh_lod": "meshes/1-10-scale-split/body.lod.glb",
        "tris_source": None, "tris": None, "tris_lod": None, "bbox": None,
        "patches": None, "patches_rev": 0, "zones": [], "zones_rev": 0,
        "segmentation": {"angle": 30.0, "min_area_fraction": 0.0001}}
    assert plan["references"][0] == {
        "id": "colored-01", "role": "colour", "source": str(root / "Render Images" / "Colored_01.jpg"),
        "file": "refs/colored-01.jpg", "status": "pending", "error": None}
    assert not any(f for f in root.rglob("*") if f.name == "plan.json")      # source untouched


def test_same_directory_is_the_same_project(tmp_path):
    root = spiderman(tmp_path / "src")
    assert Project.open_or_create(scan(root)).slug == Project.open_or_create(scan(root)).slug
    assert len(list_projects()) == 1
    assert list_projects()[0]["name"] == "src" and list_projects()[0]["source"] == str(root)


def test_update_bumps_revision_persists_and_notifies(tmp_path):
    p = Project.open_or_create(scan(flat(tmp_path / "src")))
    seen = []
    off = p.subscribe(seen.append)
    rev = p.update(lambda plan: plan.__setitem__("active_variant", plan["variants"][0]["id"]))
    assert rev == 2 and seen == [2]
    assert json.loads((p.dir / "plan.json").read_text())["active_variant"] == "src"
    off()
    p.update(lambda plan: None)
    assert seen == [2]


def test_snapshot_is_a_copy(tmp_path):
    p = Project.open_or_create(scan(flat(tmp_path / "src")))
    p.snapshot()["variants"].clear()
    assert len(p.snapshot()["variants"]) == 1


def test_reopen_keeps_finished_parts_and_adds_new_files(tmp_path):
    root = flat(tmp_path / "src")
    p = Project.open_or_create(scan(root))
    p.update(lambda plan: plan["variants"][0]["parts"][0].update(status="ready", tris=12))
    write_binary_stl(root / "d.stl", *cube())
    plan = Project.open_or_create(scan(root)).snapshot()
    assert [(x["id"], x["status"]) for x in plan["variants"][0]["parts"]] == [
        ("a", "ready"), ("b", "pending"), ("c", "pending"), ("d", "pending")]
    assert plan["variants"][0]["parts"][0]["tris"] == 12


def test_interrupted_processing_is_reset_on_load(tmp_path):
    p = Project.open_or_create(scan(flat(tmp_path / "src")))
    p.update(lambda plan: plan["variants"][0]["parts"][1].update(status="processing"))
    workspace._projects.clear()                                   # simulate a restart
    assert Project.load(p.slug).snapshot()["variants"][0]["parts"][1]["status"] == "pending"


def test_ready_without_a_mesh_file_is_reset_on_load(tmp_path):
    p = Project.open_or_create(scan(flat(tmp_path / "src")))
    p.update(lambda plan: plan["variants"][0]["parts"][0].update(status="ready"))
    workspace._projects.clear()
    assert Project.load(p.slug).snapshot()["variants"][0]["parts"][0]["status"] == "pending"


def test_load_works_when_the_source_is_gone(tmp_path):
    root = flat(tmp_path / "src")
    slug = Project.open_or_create(scan(root)).slug
    shutil.rmtree(root)
    workspace._projects.clear()
    assert get_project(slug).snapshot()["name"] == "src"


def test_file_refuses_to_leave_the_workspace(tmp_path):
    p = Project.open_or_create(scan(flat(tmp_path / "src")))
    assert p.file("meshes/src/a.glb") == p.dir / "meshes/src/a.glb"
    for bad in ("../x", "/etc/passwd", "meshes/../../x"):
        with pytest.raises(ValueError):
            p.file(bad)


def test_unknown_slug():
    with pytest.raises(KeyError):
        get_project("nope")


def test_find_outliers_flags_the_banner_only():
    figure = {"torso": ((-18, 87, -26), (26, 147, 15)), "leg": ((-33, 46, -16), (27, 98, 29)),
              "base": ((-62, -41, -12), (67, 40, 66))}
    assert find_outliers(figure | {"banner": ((0, 0, 0), (576, 65, 50))}) == {"banner"}
    assert find_outliers(figure) == set() and find_outliers({"only": ((0, 0, 0), (1, 1, 1))}) == set()


def test_failed_items_are_retried_after_a_restart(tmp_path):
    p = Project.open_or_create(scan(flat(tmp_path / "src")))
    p.update(lambda plan: plan["variants"][0]["parts"][0].update(status="error", error="source file is missing"))
    workspace._projects.clear()
    part = Project.load(p.slug).snapshot()["variants"][0]["parts"][0]
    assert part["status"] == "pending" and part["error"] is None


def test_loading_from_disk_always_moves_the_revision(tmp_path):
    # A page left open across a restart compares revisions to decide whether to refetch.
    p = Project.open_or_create(scan(flat(tmp_path / "src")))
    assert p.snapshot()["revision"] == 1
    workspace._projects.clear()
    assert Project.load(p.slug).snapshot()["revision"] == 2


def test_recheck_requeues_failures_and_missing_meshes_but_not_running_work(tmp_path):
    p = Project.open_or_create(scan(flat(tmp_path / "src")))

    def setup(plan):
        a, b, c = plan["variants"][0]["parts"]
        a.update(status="error", error="source file is missing")
        b.update(status="ready")                       # but its mesh file does not exist
        c.update(status="processing")
    before = p.update(setup)
    assert p.recheck() is True
    parts = p.snapshot()["variants"][0]["parts"]
    assert [(x["status"], x["error"]) for x in parts] == [("pending", None), ("pending", None), ("processing", None)]
    assert p.snapshot()["revision"] == before + 1
    assert p.recheck() is False and p.snapshot()["revision"] == before + 1


NEW_PART_FIELDS = {"patches": None, "patches_rev": 0, "zones": [], "zones_rev": 0,
                   "segmentation": {"angle": 30.0, "min_area_fraction": 0.0001}}


def test_new_parts_carry_zone_and_patch_fields(tmp_path):
    part = Project.open_or_create(scan(flat(tmp_path / "src"))).snapshot()["variants"][0]["parts"][0]
    assert {k: part[k] for k in NEW_PART_FIELDS} == NEW_PART_FIELDS


def test_version_1_plans_gain_zone_fields_on_load(tmp_path):
    p = Project.open_or_create(scan(flat(tmp_path / "src")))
    path = p.dir / "plan.json"
    old = json.loads(path.read_text())
    old["version"] = 1
    for part in old["variants"][0]["parts"]:
        for key in NEW_PART_FIELDS:
            del part[key]
    path.write_text(json.dumps(old))
    workspace._projects.clear()
    plan = Project.load(p.slug).snapshot()
    assert plan["version"] == 2
    assert all({k: part[k] for k in NEW_PART_FIELDS} == NEW_PART_FIELDS for part in plan["variants"][0]["parts"])
    assert json.loads(path.read_text())["version"] == 2


def test_ready_without_analysis_files_is_reset_on_load(tmp_path):
    from wpm.glb import write_glb
    p = Project.open_or_create(scan(flat(tmp_path / "src")))
    part = p.snapshot()["variants"][0]["parts"][0]
    write_glb(p.file(part["mesh"]), *cube())
    write_glb(p.file(part["mesh_lod"]), *cube())
    p.update(lambda plan: plan["variants"][0]["parts"][0].update(status="ready"))
    workspace._projects.clear()
    assert Project.load(p.slug).snapshot()["variants"][0]["parts"][0]["status"] == "pending"


def test_part_lookup(tmp_path):
    p = Project.open_or_create(scan(flat(tmp_path / "src")))
    assert p.part("src", "b")["id"] == "b"
    for variant, part in (("src", "nope"), ("nope", "a")):
        with pytest.raises(KeyError):
            p.part(variant, part)
