import numpy as np
import pytest

from tests.meshes import cube, write_ascii_stl, write_binary_stl
from wpm.stl import StlError, read_stl


def test_reads_and_welds_a_cube(tmp_path):
    v, f = read_stl(write_binary_stl(tmp_path / "cube.stl", *cube()))
    assert v.dtype == np.float32 and v.shape == (8, 3)      # 36 corners welded to 8
    assert f.dtype == np.uint32 and f.shape == (12, 3)
    assert f.max() == 7


def test_drops_degenerate_faces(tmp_path):
    v, f = cube()
    f = np.vstack([f, [[0, 0, 1]]])                          # zero-area triangle
    _, faces = read_stl(write_binary_stl(tmp_path / "c.stl", v, f))
    assert len(faces) == 12


def test_ascii_stl_is_rejected_with_a_reason(tmp_path):
    with pytest.raises(StlError, match="ASCII"):
        read_stl(write_ascii_stl(tmp_path / "a.stl", *cube()))


def test_truncated_file_is_rejected(tmp_path):
    p = write_binary_stl(tmp_path / "t.stl", *cube())
    p.write_bytes(p.read_bytes()[:-30])
    with pytest.raises(StlError, match="truncated"):
        read_stl(p)


def test_empty_mesh_is_rejected(tmp_path):
    p = tmp_path / "e.stl"
    p.write_bytes(b"\0" * 80 + (0).to_bytes(4, "little"))
    with pytest.raises(StlError, match="no triangles"):
        read_stl(p)


def test_non_finite_coordinates_are_rejected(tmp_path):
    v, f = cube()
    v[0, 0] = np.nan
    with pytest.raises(StlError, match="non-finite"):
        read_stl(write_binary_stl(tmp_path / "nan.stl", v, f))
