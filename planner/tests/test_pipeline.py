import json

import numpy as np
import pytest

from tests.meshes import cube, icosphere, write_ascii_stl, write_binary_stl
from wpm.decimate import decimate
from wpm.glb import read_glb, write_glb
from wpm.pipeline import process_part
from wpm.stl import StlError


def test_decimate_reaches_the_target_and_keeps_the_shape():
    v, f = icosphere(5)                                    # 20480 faces
    dv, df = decimate(v, f, 2000)
    assert len(df) <= 2000 and len(df) > 1500
    assert np.allclose(dv.min(0), v.min(0), atol=0.5) and np.allclose(dv.max(0), v.max(0), atol=0.5)
    assert df.max() < len(dv)


def test_decimate_leaves_a_small_mesh_alone():
    v, f = cube()
    dv, df = decimate(v, f, 2000)
    assert len(df) == 12 and len(dv) == 8


def test_glb_round_trip(tmp_path):
    v, f = icosphere(2)
    write_glb(tmp_path / "m.glb", v, f)
    rv, rf = read_glb(tmp_path / "m.glb")
    assert np.array_equal(rv, v.astype(np.float32)) and np.array_equal(rf, f.astype(np.uint32))


def test_glb_declares_bounds_and_is_valid_gltf2(tmp_path):
    v, f = cube()
    write_glb(tmp_path / "m.glb", v, f)
    raw = (tmp_path / "m.glb").read_bytes()
    assert raw[:4] == b"glTF" and int.from_bytes(raw[4:8], "little") == 2
    assert int.from_bytes(raw[8:12], "little") == len(raw)
    doc = json.loads(raw[20:20 + int.from_bytes(raw[12:16], "little")])
    pos = doc["accessors"][doc["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
    assert pos["min"] == [0.0, 0.0, 0.0] and pos["max"] == [10.0, 10.0, 10.0]


def test_process_part_writes_both_meshes(tmp_path):
    src = write_binary_stl(tmp_path / "s.stl", *icosphere(5))
    r = process_part(src, tmp_path / "out/p.glb", tmp_path / "out/p.lod.glb", target=4000, lod_target=800)
    assert r.tris_source == 20480 and r.tris <= 4000 and r.tris_lod <= 800
    assert len(read_glb(tmp_path / "out/p.glb")[1]) == r.tris
    assert len(read_glb(tmp_path / "out/p.lod.glb")[1]) == r.tris_lod
    assert r.bbox[0][0] == pytest.approx(-10, abs=0.5)


def test_process_part_leaves_no_partial_files_on_failure(tmp_path):
    bad = write_ascii_stl(tmp_path / "a.stl", *cube())
    with pytest.raises(StlError):
        process_part(bad, tmp_path / "out/p.glb", tmp_path / "out/p.lod.glb")
    out = tmp_path / "out"
    assert not out.exists() or not any(out.iterdir())
