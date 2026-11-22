"""Read a binary STL into welded vertices and faces."""
from pathlib import Path

import numpy as np

_RECORD = np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
_HEADER = 84


class StlError(Exception):
    """The file cannot be used as a part mesh; the message says why."""


def read_stl(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Return (vertices float32 (n, 3), faces uint32 (m, 3)) with duplicate corners welded."""
    path = Path(path)
    size = path.stat().st_size
    with open(path, "rb") as fh:
        head = fh.read(_HEADER)
    count = int.from_bytes(head[80:84], "little") if len(head) == _HEADER else -1
    if count < 0 or size != _HEADER + _RECORD.itemsize * count:
        if head.lstrip().lower().startswith(b"solid"):
            raise StlError("ASCII STL is not supported")
        raise StlError("STL file is truncated or corrupt")
    if count == 0:
        raise StlError("STL has no triangles")

    corners = np.ascontiguousarray(np.fromfile(path, dtype=_RECORD, offset=_HEADER)["v"].reshape(-1, 3))
    if not np.isfinite(corners).all():
        raise StlError("STL has non-finite coordinates")
    # Weld corners that are bit-identical: STL repeats each shared vertex exactly.
    rows = corners.view(np.dtype((np.void, corners.dtype.itemsize * 3))).ravel()
    _, first, inverse = np.unique(rows, return_index=True, return_inverse=True)
    vertices = corners[first]
    faces = inverse.reshape(-1, 3).astype(np.uint32)

    a, b, c = faces[:, 0], faces[:, 1], faces[:, 2]
    faces = faces[(a != b) & (b != c) & (a != c)]
    if len(faces) == 0:
        raise StlError("STL has no triangles")
    return vertices, faces
