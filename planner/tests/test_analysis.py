import json

import numpy as np

from tests.meshes import cube, icosphere
from wpm.analysis import analyse_part, analysis_files, lod_map, masks, patch_stats, relief_scale, segment
from wpm.glb import write_glb


def plate_with_tent(height=8.0):
    """A flat 30 x 30 plate of 3 x 3 squares whose middle square is a four-sided tent."""
    grid = [[x * 10.0, y * 10.0, 0.0] for y in range(4) for x in range(4)]
    v = np.array(grid + [[15.0, 15.0, height]], dtype=np.float32)
    f = []
    for y in range(3):
        for x in range(3):
            a, b, c, d = y * 4 + x, y * 4 + x + 1, (y + 1) * 4 + x + 1, (y + 1) * 4 + x
            f += [[a, b, 16], [b, c, 16], [c, d, 16], [d, a, 16]] if (x, y) == (1, 1) else [[a, b, c], [a, c, d]]
    return v, np.array(f, dtype=np.uint32)


def areas_by_patch(v, f, patches):
    tri = v[f]
    area = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1) / 2
    return np.bincount(patches, weights=area)


def test_a_cube_has_six_patches():
    patches = segment(*cube())
    assert patches.dtype == np.uint32 and sorted(set(patches.tolist())) == [0, 1, 2, 3, 4, 5]
    assert np.bincount(patches).tolist() == [2] * 6


def test_a_sphere_is_one_patch():
    assert set(segment(*icosphere(3)).tolist()) == {0}


def test_patches_are_numbered_by_area():
    v, f = cube()
    v = v * np.array([1, 1, 4], dtype=np.float32)
    assert areas_by_patch(v, f, segment(v, f)).tolist() == [400.0] * 4 + [100.0] * 2


def test_slivers_merge_into_a_neighbour():
    v, f = plate_with_tent()
    patches = segment(v, f, min_area_fraction=0.06)
    area = areas_by_patch(v, f, patches)
    assert area.min() >= 0.06 * area.sum() and len(area) <= 3
    assert len(set(patches[:8].tolist())) == 1                 # the plate itself stays whole


def test_min_area_zero_keeps_everything():
    v, f = plate_with_tent()
    assert len(set(segment(v, f, min_area_fraction=0).tolist())) == 5


def test_a_wider_angle_cuts_less():
    v, f = plate_with_tent(height=2.0)                         # tent sides rise at about 22 degrees
    assert len(set(segment(v, f, angle=15.0, min_area_fraction=0).tolist())) == 5
    assert len(set(segment(v, f, angle=60.0, min_area_fraction=0).tolist())) == 1


def test_masks_mark_recesses_and_bumps():
    v, f = icosphere(3)
    dent, bump = int(np.argmax(v[:, 2])), int(np.argmin(v[:, 2]))
    v[dent] *= 0.7
    v[bump] *= 1.3
    cavity, ridge = masks(v, f)
    assert cavity.dtype == ridge.dtype == np.uint8 and len(cavity) == len(ridge) == len(v)
    assert cavity[dent] > 150 and ridge[dent] == 0
    assert ridge[bump] > 150 and cavity[bump] == 0
    # The rest of the sphere is evenly convex: clearly raised, clearly less than the bump, and all much alike.
    plain = [i for i in range(len(v)) if abs(v[i][2]) < 2.0]
    assert 60 < ridge[plain].min() and ridge[plain].max() < 150 and cavity[plain].max() == 0


def test_masks_are_measured_against_what_is_typical_for_the_part():
    values = np.array([0.0, 1.0, 1.0, 5.0])
    even = np.ones(4)
    scaled = relief_scale(values, even)
    assert scaled.dtype == np.uint8 and scaled[0] == 0 and scaled[1] == scaled[2] and 0 < scaled[1] < scaled[3] < 255
    assert relief_scale(values * 40, even).tolist() == scaled.tolist()            # the size of the model does not matter
    assert relief_scale(np.r_[np.zeros(99), 9.0], np.ones(100))[99] == 255         # far above typical: full
    # Where the strong relief covers most of the surface it is the typical one, and everything reads lower.
    assert relief_scale(values, np.array([1.0, 1.0, 1.0, 20.0]))[1] < scaled[1]
    assert relief_scale(np.zeros(3), np.ones(3)).tolist() == [0, 0, 0]
    assert relief_scale(np.full(5, 3.0), np.ones(5)).tolist() == [102] * 5        # an even surface stays even: 1 / 2.5


def test_patch_stats():
    v, f = cube()
    stats = patch_stats(v, f, segment(v, f))
    assert [s["id"] for s in stats] == [0, 1, 2, 3, 4, 5]
    assert all(s["faces"] == 2 and s["area"] == 100.0 and len(s["neighbours"]) == 4 for s in stats)
    bottom = next(s for s in stats if s["bbox"][1][2] == 0.0)
    assert bottom["centroid"] == [5.0, 5.0, 0.0] and bottom["bbox"] == [[0.0, 0.0, 0.0], [10.0, 10.0, 0.0]]


def test_lod_map_points_at_nearby_faces():
    v, f = icosphere(4)
    lv, lf = icosphere(2)
    mapping = lod_map(v, f, lv, lf)
    assert mapping.dtype == np.uint32 and len(mapping) == len(lf) and mapping.max() < len(f)
    distance = np.linalg.norm(v[f[mapping]].mean(1) - lv[lf].mean(1), axis=1)
    assert distance.max() < 3.0


def test_analyse_part_writes_sidecars(tmp_path):
    v, f = cube()
    write_glb(tmp_path / "p.glb", v, f)
    write_glb(tmp_path / "p.lod.glb", v, f)
    result = analyse_part(tmp_path / "p.glb", tmp_path / "p.lod.glb", 30.0, 1e-4)
    files = analysis_files(tmp_path / "p.glb")
    assert {k: p.name for k, p in files.items()} == {
        "patches": "p.patches.u32", "masks": "p.masks.u8", "stats": "p.patches.json", "lodmap": "p.lodmap.u32",
        "lodmasks": "p.lodmasks.u8"}
    assert result == {"patches": 6}
    assert files["patches"].stat().st_size == 4 * 12 and files["masks"].stat().st_size == 2 * 8
    assert files["lodmap"].stat().st_size == 4 * 12 and len(json.loads(files["stats"].read_text())) == 6
    assert np.array_equal(np.fromfile(files["lodmap"], dtype="<u4"), np.arange(12))
    assert not list(tmp_path.glob("*.tmp"))


def test_relief_of_the_assembled_view_mesh(tmp_path):
    # Three bytes per assembled-view face: cavity, ridge, and how much the face looks up.
    v, f = cube()
    write_glb(tmp_path / "p.glb", v, f)
    write_glb(tmp_path / "p.lod.glb", v, f)
    analyse_part(tmp_path / "p.glb", tmp_path / "p.lod.glb", 30.0, 1e-4)
    relief = np.fromfile(analysis_files(tmp_path / "p.glb")["lodmasks"], dtype=np.uint8).reshape(-1, 3)
    assert len(relief) == 12
    cavity, ridge = masks(v, f)
    assert np.array_equal(relief[:, 0], np.round(cavity[f].mean(1)).astype(np.uint8))
    assert np.array_equal(relief[:, 1], np.round(ridge[f].mean(1)).astype(np.uint8)) and relief[:, 1].min() > 0
    assert relief[:, 2].tolist() == [128, 128, 128, 128, 1, 1, 255, 255, 128, 128, 128, 128]


def test_relief_follows_the_face_map(tmp_path):
    v, f = icosphere(3)
    lv, lf = icosphere(1)
    write_glb(tmp_path / "p.glb", v, f)
    write_glb(tmp_path / "p.lod.glb", lv, lf)
    analyse_part(tmp_path / "p.glb", tmp_path / "p.lod.glb", 30.0, 1e-4)
    files = analysis_files(tmp_path / "p.glb")
    relief = np.fromfile(files["lodmasks"], dtype=np.uint8).reshape(-1, 3)
    mapping = np.fromfile(files["lodmap"], dtype="<u4")
    assert len(relief) == len(lf) == 80
    tri = v[f[mapping]].astype(np.float64)
    normal = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    up = np.round(normal[:, 1] / np.linalg.norm(normal, axis=1) * 127) + 128
    assert np.array_equal(relief[:, 2], up.astype(np.uint8)) and relief[:, 2].min() < 40 and relief[:, 2].max() > 215
