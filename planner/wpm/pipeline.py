"""One part: source STL -> preview GLB + lighter assembled-view GLB + stats."""
from dataclasses import dataclass
from pathlib import Path

from wpm.decimate import decimate
from wpm.glb import write_glb
from wpm.stl import read_stl

PREVIEW_TRIS = 150_000
LOD_TRIS = 30_000

Vec3 = tuple[float, float, float]


@dataclass(frozen=True)
class PartResult:
    tris_source: int
    tris: int
    tris_lod: int
    bbox: tuple[Vec3, Vec3]


def bbox_of(vertices) -> tuple[Vec3, Vec3]:
    lo, hi = vertices.min(0), vertices.max(0)
    return tuple(float(x) for x in lo), tuple(float(x) for x in hi)


def process_part(src: Path, mesh_path: Path, lod_path: Path,
                 target: int = PREVIEW_TRIS, lod_target: int = LOD_TRIS) -> PartResult:
    """Raises StlError when the source cannot be read; nothing is written in that case."""
    vertices, faces = read_stl(src)
    pv, pf = decimate(vertices, faces, target)
    lv, lf = decimate(pv, pf, lod_target)
    # The preview mesh is written last: its existence means the part is complete.
    write_glb(lod_path, lv, lf)
    write_glb(mesh_path, pv, pf)
    return PartResult(tris_source=len(faces), tris=len(pf), tris_lod=len(lf), bbox=bbox_of(pv))
