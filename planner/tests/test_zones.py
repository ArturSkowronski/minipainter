from concurrent.futures import ThreadPoolExecutor

import pytest

from tests.packages import flat
from wpm import zones
from wpm.jobs import Processor
from wpm.profiles.nomnom import scan
from wpm.workspace import Project


@pytest.fixture
def project(tmp_path):
    """A processed flat package: three cube parts (12 faces each) in variant "src"."""
    p = Project.open_or_create(scan(flat(tmp_path / "src")))
    processor = Processor(ThreadPoolExecutor(max_workers=1))
    processor.enqueue_variant(p, "src")
    assert processor.wait_idle(30)
    processor.shutdown()
    return p


def test_zone_ids_names_and_colours(project):
    first = zones.create_zone(project, "src", "a")
    second = zones.create_zone(project, "src", "a", name="  Czerwień kostiumu ", color="#B3202A")
    assert first == {"id": 1, "name": "Strefa 1", "color": zones.PALETTE[0]}
    assert second == {"id": 2, "name": "Czerwień kostiumu", "color": "#b3202a"}
    assert project.part("src", "a")["zones"] == [first, second]
    assert project.part("src", "b")["zones"] == []
    assert len(zones.PALETTE) == 12 and len(set(zones.PALETTE)) == 12


def test_the_smallest_free_id_is_reused(project):
    for _ in range(3):
        zones.create_zone(project, "src", "a")
    zones.delete_zone(project, "src", "a", 2)
    assert zones.create_zone(project, "src", "a")["id"] == 2
    assert [z["id"] for z in project.part("src", "a")["zones"]] == [1, 2, 3]


def test_update_validates(project):
    zones.create_zone(project, "src", "a")
    assert zones.update_zone(project, "src", "a", 1, name="Błękit", color="#2a5caa") == {
        "id": 1, "name": "Błękit", "color": "#2a5caa"}
    assert zones.update_zone(project, "src", "a", 1, name="Tylko nazwa")["color"] == "#2a5caa"
    for bad in ({"name": "   "}, {"name": "x" * 61}, {"color": "red"}, {"color": "#12345"}):
        with pytest.raises(ValueError):
            zones.update_zone(project, "src", "a", 1, **bad)
    with pytest.raises(KeyError):
        zones.update_zone(project, "src", "a", 9, name="x")
    with pytest.raises(KeyError):
        zones.create_zone(project, "src", "nope")


def test_faces_round_trip_and_default_to_no_zone(project):
    assert zones.read_faces(project, "src", "a") == bytes(12)
    zones.create_zone(project, "src", "a")
    before = project.part("src", "a")["zones_rev"]
    data = bytes([1] * 5 + [0] * 7)
    assert zones.write_faces(project, "src", "a", data) == before + 1
    assert zones.read_faces(project, "src", "a") == data
    assert zones.read_faces(project, "src", "b") == bytes(12)


def test_bad_face_data_is_refused_and_nothing_is_stored(project):
    zones.create_zone(project, "src", "a")
    good = bytes([1] * 12)
    zones.write_faces(project, "src", "a", good)
    revision = project.snapshot()["revision"]
    for bad in (bytes(11), bytes(13), bytes([2] * 12), b""):
        with pytest.raises(ValueError):
            zones.write_faces(project, "src", "a", bad)
    assert zones.read_faces(project, "src", "a") == good and project.snapshot()["revision"] == revision


def test_deleting_a_zone_frees_only_its_faces(project):
    for _ in range(2):
        zones.create_zone(project, "src", "a")
    zones.write_faces(project, "src", "a", bytes([1] * 4 + [2] * 4 + [0] * 4))
    before = project.part("src", "a")["zones_rev"]
    zones.delete_zone(project, "src", "a", 1)
    assert zones.read_faces(project, "src", "a") == bytes([0] * 4 + [2] * 4 + [0] * 4)
    assert project.part("src", "a")["zones_rev"] == before + 1
    assert zones.create_zone(project, "src", "a")["id"] == 1                  # the id comes back empty
    assert zones.read_faces(project, "src", "a").count(1) == 0
    with pytest.raises(KeyError):
        zones.delete_zone(project, "src", "a", 7)


def test_resegment_keeps_zones(project):
    zones.create_zone(project, "src", "a")
    data = bytes([1] * 6 + [0] * 6)
    zones.write_faces(project, "src", "a", data)
    before = project.part("src", "a")
    result = zones.resegment(project, "src", "a", angle=89.0, min_area_fraction=0.0)
    after = project.part("src", "a")
    assert before["patches"] == 6 and result == {"patches": 6, "patches_rev": before["patches_rev"] + 1}
    assert zones.resegment(project, "src", "a", angle=100.0, min_area_fraction=0.0)["patches"] == 1
    assert project.part("src", "a")["segmentation"] == {"angle": 100.0, "min_area_fraction": 0.0}
    assert zones.read_faces(project, "src", "a") == data and after["zones_rev"] == before["zones_rev"]
    for bad in ((0.5, 0.0), (181.0, 0.0), (30.0, -0.1), (30.0, 0.06)):
        with pytest.raises(ValueError):
            zones.resegment(project, "src", "a", *bad)
