"""What the frozen preview mesh tells us about a part: patches, relief masks, and how the lighter
assembled-view mesh maps onto it. Results are sidecar files next to the mesh.

Patches are cut where the sculpt has a crease. They are a way to select many faces at once, nothing more:
zone membership is stored per face and survives any re-cut.
"""
import json
import os
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from wpm.glb import read_glb

DEFAULT_ANGLE = 30.0
DEFAULT_MIN_AREA_FRACTION = 1e-4


def _face_geometry(vertices: np.ndarray, faces: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Unit normals and areas per face."""
    tri = vertices[faces].astype(np.float64)
    cross = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    length = np.linalg.norm(cross, axis=1)
    normals = np.divide(cross, length[:, None], out=np.zeros_like(cross), where=length[:, None] > 0)
    return normals, length / 2


def face_pairs(faces: np.ndarray, n_vertices: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """For every edge shared by two faces: face a, face b, and the edge's two vertex ids (k, 2)."""
    n_faces = len(faces)
    edges = np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]).astype(np.int64), axis=1)
    key = edges[:, 0] * n_vertices + edges[:, 1]
    owner = np.tile(np.arange(n_faces), 3)
    order = np.argsort(key, kind="stable")
    key, owner, edges = key[order], owner[order], edges[order]
    same = key[1:] == key[:-1]
    return owner[:-1][same], owner[1:][same], edges[:-1][same]


def _components(n: int, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    graph = coo_matrix((np.ones(len(a), dtype=np.int8), (a, b)), shape=(n, n))
    return connected_components(graph, directed=False)[1]


def segment(vertices: np.ndarray, faces: np.ndarray, angle: float = DEFAULT_ANGLE,
            min_area_fraction: float = DEFAULT_MIN_AREA_FRACTION) -> np.ndarray:
    """Patch id per face (uint32), numbered from 0 by descending area."""
    normals, area = _face_geometry(vertices, faces)
    fa, fb, edge = face_pairs(faces, len(vertices))
    smooth = (normals[fa] * normals[fb]).sum(1) > np.cos(np.radians(angle))
    label = _components(len(faces), fa[smooth], fb[smooth])

    edge_length = np.linalg.norm(vertices[edge[:, 0]].astype(np.float64) - vertices[edge[:, 1]], axis=1)
    min_area = min_area_fraction * area.sum()
    while min_area > 0:
        patch_area = np.bincount(label, weights=area)
        small = patch_area < min_area
        la, lb = label[fa], label[fb]
        border = la != lb
        if not small.any() or not border.any():
            break
        # Total shared edge length between each pair of neighbouring patches, both directions.
        n = len(patch_area)
        shared = coo_matrix((edge_length[border], (la[border], lb[border])), shape=(n, n))
        shared = (shared + shared.T).tocoo()
        rows, cols, weight = shared.row, shared.col, shared.data
        keep = small[rows]
        if not keep.any():
            break
        rows, cols, weight = rows[keep], cols[keep], weight[keep]
        order = np.lexsort((-weight, rows))                  # per small patch, longest border first
        rows, cols = rows[order], cols[order]
        first = np.r_[True, rows[1:] != rows[:-1]]
        # Merge every small patch into its best neighbour; chains and cycles collapse into one group.
        group = _components(n, rows[first], cols[first])
        label = group[label]
        if len(np.unique(group)) == n:
            break

    # Renumber by descending area (ties by first face, so the result is deterministic).
    ids, first_face, inverse = np.unique(label, return_index=True, return_inverse=True)
    patch_area = np.bincount(inverse, weights=area)
    rank = np.empty(len(ids), dtype=np.int64)
    rank[np.lexsort((first_face, -np.round(patch_area, 6)))] = np.arange(len(ids))
    return rank[inverse].astype(np.uint32)


def masks(vertices: np.ndarray, faces: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(cavity, ridge) per vertex as uint8: where shade collects, and where highlights go."""
    n = len(vertices)
    v = vertices.astype(np.float64)
    normals, area = _face_geometry(vertices, faces)
    vertex_normal = np.zeros((n, 3))
    np.add.at(vertex_normal, faces.ravel(), np.repeat(normals * area[:, None], 3, axis=0))
    vertex_normal /= np.linalg.norm(vertex_normal, axis=1, keepdims=True) + 1e-20

    edges = np.unique(np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1), axis=0)
    i, j = np.r_[edges[:, 0], edges[:, 1]], np.r_[edges[:, 1], edges[:, 0]]
    neighbours = coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n)).tocsr()
    degree = np.maximum(np.asarray(neighbours.sum(1)).ravel(), 1)
    edge_length = np.linalg.norm(v[edges[:, 0]] - v[edges[:, 1]], axis=1)
    mean_edge = np.zeros(n)
    np.add.at(mean_edge, edges.ravel(), np.repeat(edge_length, 2))
    mean_edge = np.maximum(mean_edge / degree, 1e-12)

    # Positive where the surface sticks out of its surroundings, negative in a recess; scale-free.
    relief = ((v - (neighbours @ v) / degree[:, None]) * vertex_normal).sum(1) / mean_edge
    for _ in range(2):
        relief = 0.5 * relief + 0.5 * (neighbours @ relief) / degree
    scale = np.percentile(np.abs(relief), 98) or 1.0
    ridge = np.clip(relief / scale, 0, 1)
    cavity = np.clip(-relief / scale, 0, 1)
    return np.round(cavity * 255).astype(np.uint8), np.round(ridge * 255).astype(np.uint8)


def patch_stats(vertices: np.ndarray, faces: np.ndarray, patches: np.ndarray) -> list[dict]:
    """Per patch: face count, area, area-weighted centroid, bounding box, neighbouring patches."""
    n = int(patches.max()) + 1
    _, area = _face_geometry(vertices, faces)
    tri = vertices[faces].astype(np.float64)
    weight = np.maximum(area, 1e-20)
    total = np.bincount(patches, weights=weight, minlength=n)
    centroid = np.stack([np.bincount(patches, weights=tri.mean(1)[:, k] * weight, minlength=n) / total
                         for k in range(3)], axis=1)
    lo = np.full((n, 3), np.inf)
    hi = np.full((n, 3), -np.inf)
    np.minimum.at(lo, patches, tri.min(1))
    np.maximum.at(hi, patches, tri.max(1))
    fa, fb, _ = face_pairs(faces, len(vertices))
    pa, pb = patches[fa], patches[fb]
    cross = pa != pb
    pairs = np.unique(np.r_[np.c_[pa[cross], pb[cross]], np.c_[pb[cross], pa[cross]]], axis=0)
    neighbours: list[list[int]] = [[] for _ in range(n)]
    for a, b in pairs.tolist():
        neighbours[a].append(b)
    count = np.bincount(patches, minlength=n)
    area_sum = np.bincount(patches, weights=area, minlength=n)
    return [{"id": p, "faces": int(count[p]), "area": round(float(area_sum[p]), 4),
             "centroid": [round(float(x), 4) for x in centroid[p]],
             "bbox": [[round(float(x), 4) for x in lo[p]], [round(float(x), 4) for x in hi[p]]],
             "neighbours": neighbours[p]} for p in range(n)]


def lod_map(vertices: np.ndarray, faces: np.ndarray, lod_vertices: np.ndarray, lod_faces: np.ndarray) -> np.ndarray:
    """For each assembled-view face, the preview face whose centroid is nearest (uint32)."""
    tree = cKDTree(vertices[faces].astype(np.float64).mean(1))
    return tree.query(lod_vertices[lod_faces].astype(np.float64).mean(1))[1].astype(np.uint32)


def lod_masks(vertices: np.ndarray, faces: np.ndarray, cavity: np.ndarray, ridge: np.ndarray,
              lodmap: np.ndarray) -> np.ndarray:
    """Per assembled-view face, from the preview face it maps to: cavity, ridge, and `up` (uint8, n x 3).

    `up` is the y of the face normal as round(y * 127) + 128: 255 looks straight up, 1 straight down.
    """
    mapped = faces[lodmap]
    normals, _ = _face_geometry(vertices, mapped)
    return np.stack([np.round(cavity[mapped].mean(1)), np.round(ridge[mapped].mean(1)),
                     np.round(normals[:, 1] * 127) + 128], axis=1).astype(np.uint8)


def analysis_files(mesh: Path) -> dict[str, Path]:
    """The sidecar files of a preview mesh `p.glb`."""
    base = mesh.with_suffix("")
    return {"patches": base.with_name(base.name + ".patches.u32"),
            "masks": base.with_name(base.name + ".masks.u8"),
            "stats": base.with_name(base.name + ".patches.json"),
            "lodmap": base.with_name(base.name + ".lodmap.u32"),
            "lodmasks": base.with_name(base.name + ".lodmasks.u8")}


def _write(path: Path, data: bytes) -> None:
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def analyse_part(mesh: Path, lod: Path, angle: float = DEFAULT_ANGLE,
                 min_area_fraction: float = DEFAULT_MIN_AREA_FRACTION) -> dict:
    """Write the sidecars of one part. Returns {"patches": count}."""
    mesh, lod = Path(mesh), Path(lod)
    vertices, faces = read_glb(mesh)
    lod_vertices, lod_faces = read_glb(lod)
    patches = segment(vertices, faces, angle, min_area_fraction)
    cavity, ridge = masks(vertices, faces)
    files = analysis_files(mesh)
    _write(files["masks"], np.stack([cavity, ridge], axis=1).tobytes())
    _write(files["stats"], json.dumps(patch_stats(vertices, faces, patches), separators=(",", ":")).encode())
    lodmap = lod_map(vertices, faces, lod_vertices, lod_faces)
    _write(files["lodmap"], lodmap.astype("<u4").tobytes())
    _write(files["lodmasks"], lod_masks(vertices, faces, cavity, ridge, lodmap).tobytes())
    _write(files["patches"], patches.astype("<u4").tobytes())        # last: its presence means "analysed"
    return {"patches": int(patches.max()) + 1}
