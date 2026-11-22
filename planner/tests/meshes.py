"""Synthetic meshes and STL writers for tests."""
from pathlib import Path

import numpy as np


def cube():
    """Axis-aligned cube, side 10, min corner at the origin: 8 vertices, 12 faces."""
    v = np.array([[x, y, z] for x in (0, 10) for y in (0, 10) for z in (0, 10)], dtype=np.float32)
    f = np.array([
        [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5],
        [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6],
        [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3],
    ], dtype=np.uint32)
    return v, f


def icosphere(subdivisions: int, radius: float = 10.0, center=(0, 0, 0)):
    """Sphere with 20 * 4**subdivisions faces."""
    t = (1 + 5 ** 0.5) / 2
    v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
         [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
         [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8],
         [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    v = [np.array(p, dtype=np.float64) / np.linalg.norm(p) for p in v]
    for _ in range(subdivisions):
        cache, nf = {}, []

        def mid(a, b):
            key = (min(a, b), max(a, b))
            if key not in cache:
                m = v[a] + v[b]
                v.append(m / np.linalg.norm(m))
                cache[key] = len(v) - 1
            return cache[key]

        for a, b, c in f:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nf += [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
        f = nf
    verts = (np.array(v) * radius + np.array(center, dtype=np.float64)).astype(np.float32)
    return verts, np.array(f, dtype=np.uint32)


def _normals(tri):
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    length = np.linalg.norm(n, axis=1, keepdims=True)
    return np.divide(n, length, out=np.zeros_like(n), where=length > 0)


def write_binary_stl(path, v, f) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tri = np.asarray(v, dtype=np.float32)[np.asarray(f)]
    rec = np.zeros(len(tri), dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]))
    rec["n"], rec["v"] = _normals(tri), tri
    with open(path, "wb") as fh:
        fh.write(b"binary stl written by tests".ljust(80, b"\0"))
        fh.write(len(tri).to_bytes(4, "little"))
        fh.write(rec.tobytes())
    return path


def write_ascii_stl(path, v, f) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tri = np.asarray(v, dtype=np.float32)[np.asarray(f)]
    lines = ["solid test"]
    for t, n in zip(tri, _normals(tri)):
        lines.append(f"facet normal {n[0]} {n[1]} {n[2]}\n outer loop")
        lines += [f"  vertex {p[0]} {p[1]} {p[2]}" for p in t]
        lines.append(" endloop\nendfacet")
    lines.append("endsolid test")
    path.write_text("\n".join(lines))
    return path
