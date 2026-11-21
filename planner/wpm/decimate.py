"""Reduce a mesh to a triangle target."""
import fast_simplification
import numpy as np


def decimate(vertices: np.ndarray, faces: np.ndarray, target: int) -> tuple[np.ndarray, np.ndarray]:
    """Return a mesh with at most `target` faces; a mesh already that small is returned unchanged."""
    if len(faces) <= target:
        return vertices, faces
    v, f = fast_simplification.simplify(
        np.ascontiguousarray(vertices, dtype=np.float32),
        np.ascontiguousarray(faces, dtype=np.uint32),
        target_count=target,
    )
    return np.asarray(v, dtype=np.float32), np.asarray(f, dtype=np.uint32)
