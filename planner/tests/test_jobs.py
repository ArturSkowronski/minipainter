from concurrent.futures import ThreadPoolExecutor

import pytest
from PIL import Image

from tests.meshes import cube, icosphere, write_ascii_stl, write_binary_stl
from tests.packages import flat, spiderman
from wpm.jobs import Processor
from wpm.profiles.nomnom import scan
from wpm.workspace import Project


@pytest.fixture
def proc():
    processor = Processor(ThreadPoolExecutor(max_workers=1))
    yield processor
    processor.shutdown()


@pytest.fixture
def project_of_flat(tmp_path):
    return Project.open_or_create(scan(flat(tmp_path / "src")))


def test_variant_is_processed_to_ready(project_of_flat, proc):
    p = project_of_flat
    proc.enqueue_variant(p, "src")
    assert proc.wait_idle(30)
    parts = p.snapshot()["variants"][0]["parts"]
    assert [x["status"] for x in parts] == ["ready"] * 3
    assert all(p.file(x["mesh"]).exists() and p.file(x["mesh_lod"]).exists() and x["tris"] > 0 for x in parts)
    assert parts[0]["tris_source"] == 12 and parts[0]["bbox"] == [[0.0, 0.0, 0.0], [10.0, 10.0, 10.0]]
    assert p.snapshot()["active_variant"] == "src"


def test_a_broken_part_does_not_stop_the_others(tmp_path, proc):
    root = flat(tmp_path / "src")
    write_ascii_stl(root / "b.stl", *cube())
    p = Project.open_or_create(scan(root))
    proc.enqueue_variant(p, "src")
    assert proc.wait_idle(30)
    by_id = {x["id"]: x for x in p.snapshot()["variants"][0]["parts"]}
    assert by_id["b"]["status"] == "error" and "ASCII" in by_id["b"]["error"]
    assert by_id["a"]["status"] == by_id["c"]["status"] == "ready"


def test_missing_source_becomes_an_error(tmp_path, proc):
    root = flat(tmp_path / "src")
    p = Project.open_or_create(scan(root))
    (root / "a.stl").unlink()
    proc.enqueue_variant(p, "src")
    assert proc.wait_idle(30)
    a = p.snapshot()["variants"][0]["parts"][0]
    assert a["status"] == "error" and a["error"] == "source file is missing"


def test_existing_meshes_are_not_regenerated(project_of_flat, proc):
    p = project_of_flat
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    mesh = p.file(p.snapshot()["variants"][0]["parts"][0]["mesh"])
    stamp = mesh.stat().st_mtime_ns
    p.update(lambda plan: plan["variants"][0]["parts"][0].update(status="pending"))
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    assert mesh.stat().st_mtime_ns == stamp
    assert p.snapshot()["variants"][0]["parts"][0]["status"] == "ready"


def test_enqueue_twice_does_not_duplicate_work(project_of_flat, proc):
    p = project_of_flat
    revs = []
    p.subscribe(revs.append)
    proc.enqueue_variant(p, "src")
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    n = len(revs)
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    assert len(revs) == n
    # one "processing" and one "ready" revision per part, plus the one that set the active variant
    assert n == 1 + 2 * 3


def test_unknown_variant_is_refused(project_of_flat, proc):
    with pytest.raises(KeyError):
        proc.enqueue_variant(project_of_flat, "nope")


def test_references_are_downscaled(tmp_path, proc):
    root = spiderman(tmp_path / "src")
    Image.new("RGB", (4000, 2000), "red").save(root / "Render Images" / "Colored_01.jpg")
    p = Project.open_or_create(scan(root))
    proc.enqueue_variant(p, "bust")
    proc.wait_idle(30)
    ref = next(r for r in p.snapshot()["references"] if r["id"] == "colored-01")
    assert ref["status"] == "ready" and Image.open(p.file(ref["file"])).size == (1600, 800)


def test_outliers_are_flagged_when_the_variant_settles(tmp_path, proc):
    d = tmp_path / "src"
    d.mkdir()
    for name, c in (("a", (0, 0, 0)), ("b", (15, 0, 0)), ("c", (0, 15, 0))):
        write_binary_stl(d / f"{name}.stl", *icosphere(2, 10, c))
    write_binary_stl(d / "banner.stl", *icosphere(2, 300))
    p = Project.open_or_create(scan(d))
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    assert {x["id"] for x in p.snapshot()["variants"][0]["parts"] if x["outlier"]} == {"banner"}


def test_default_executor_runs_in_a_worker_process(project_of_flat):
    processor = Processor()
    try:
        processor.enqueue_variant(project_of_flat, "src")
        assert processor.wait_idle(60)
        assert [x["status"] for x in project_of_flat.snapshot()["variants"][0]["parts"]] == ["ready"] * 3
    finally:
        processor.shutdown()


def test_failed_parts_are_retried_only_when_asked(tmp_path, proc):
    root = flat(tmp_path / "src")
    p = Project.open_or_create(scan(root))
    (root / "a.stl").rename(root / "a.away")
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    (root / "a.away").rename(root / "a.stl")           # the drive came back
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    assert p.snapshot()["variants"][0]["parts"][0]["status"] == "error"
    proc.enqueue_variant(p, "src", retry=True)
    proc.wait_idle(30)
    assert p.snapshot()["variants"][0]["parts"][0]["status"] == "ready"


def test_processing_writes_analysis_files_and_patch_count(project_of_flat, proc):
    from wpm.analysis import analysis_files
    p = project_of_flat
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    part = p.snapshot()["variants"][0]["parts"][0]
    assert part["status"] == "ready" and part["patches"] == 6 and part["patches_rev"] == 1
    assert all(f.exists() for f in analysis_files(p.file(part["mesh"])).values())


def test_frozen_meshes_are_analysed_not_regenerated(project_of_flat, proc):
    from wpm.analysis import analysis_files
    p = project_of_flat
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    part = p.snapshot()["variants"][0]["parts"][0]
    meshes = [p.file(part["mesh"]), p.file(part["mesh_lod"])]
    stamps = [m.stat().st_mtime_ns for m in meshes]
    for sidecar in analysis_files(meshes[0]).values():
        sidecar.unlink()
    p.update(lambda plan: plan["variants"][0]["parts"][0].update(status="pending", patches=None))
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    after = p.snapshot()["variants"][0]["parts"][0]
    assert after["status"] == "ready" and after["patches"] == 6 and after["patches_rev"] == 2
    assert [m.stat().st_mtime_ns for m in meshes] == stamps
    assert all(f.exists() for f in analysis_files(meshes[0]).values())


def test_a_ready_part_without_a_patch_count_gets_one(project_of_flat, proc):
    # The server can stop after the sidecars are written and before the plan records them.
    p = project_of_flat
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    p.update(lambda plan: plan["variants"][0]["parts"][0].update(status="pending", patches=None))
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    part = p.snapshot()["variants"][0]["parts"][0]
    assert part["status"] == "ready" and part["patches"] == 6


def test_a_part_analysed_before_the_figure_relief_existed_is_analysed_again(project_of_flat, proc):
    from wpm import workspace
    from wpm.analysis import analysis_files
    p = project_of_flat
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    part = p.snapshot()["variants"][0]["parts"][0]
    meshes = [p.file(part["mesh"]), p.file(part["mesh_lod"])]
    stamps = [m.stat().st_mtime_ns for m in meshes]
    patches = analysis_files(meshes[0])["patches"].read_bytes()
    analysis_files(meshes[0])["lodmasks"].unlink()
    workspace._projects.clear()
    p = Project.load(p.slug)
    assert p.snapshot()["variants"][0]["parts"][0]["status"] == "pending"
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    after = p.snapshot()["variants"][0]["parts"][0]
    assert after["status"] == "ready" and after["patches"] == part["patches"]
    assert [m.stat().st_mtime_ns for m in meshes] == stamps
    assert analysis_files(meshes[0])["lodmasks"].exists()
    assert analysis_files(meshes[0])["patches"].read_bytes() == patches


def test_an_analysis_made_by_an_older_version_is_redone(project_of_flat, proc):
    from wpm import workspace
    from wpm.analysis import ANALYSIS_VERSION
    p = project_of_flat
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    part = p.snapshot()["variants"][0]["parts"][0]
    assert part["analysis"] == ANALYSIS_VERSION
    stamp = p.file(part["mesh"]).stat().st_mtime_ns
    p.update(lambda plan: plan["variants"][0]["parts"][0].update(analysis=ANALYSIS_VERSION - 1))
    workspace._projects.clear()
    p = Project.load(p.slug)
    statuses = [x["status"] for x in p.snapshot()["variants"][0]["parts"]]
    assert statuses == ["pending", "ready", "ready"]
    proc.enqueue_variant(p, "src")
    proc.wait_idle(30)
    after = p.snapshot()["variants"][0]["parts"][0]
    assert after["status"] == "ready" and after["analysis"] == ANALYSIS_VERSION
    assert p.file(part["mesh"]).stat().st_mtime_ns == stamp
