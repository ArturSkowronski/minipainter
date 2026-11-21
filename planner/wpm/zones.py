"""Zones of one part: named colour areas, and which preview-mesh face belongs to which.

Membership is one byte per face (0 = no zone, 1..255 = zone id within the part), stored outside the
plan so that painting never rewrites it. Functions raise KeyError for an unknown variant, part or zone
and ValueError (with a reason) for bad input.
"""
import os
import re
import threading
from pathlib import Path

import numpy as np

from wpm.analysis import analyse_part
from wpm.workspace import Project, find_part

MAX_ZONES = 255
# Distinct on primer grey, and from each other.
PALETTE = ("#c0392b", "#2a6fbb", "#f1c40f", "#27ae60", "#8e44ad", "#e67e22",
           "#16a085", "#d35485", "#7f8c2d", "#34495e", "#e8d5b5", "#6d4c41")
_HEX = re.compile(r"#[0-9a-f]{6}")
_lock = threading.Lock()          # zone edits are rare and small: one at a time keeps file and plan in step


def _faces_path(project: Project, variant_id: str, part_id: str) -> Path:
    return project.dir / "zones" / variant_id / f"{part_id}.u8"


def _clean_name(name: str) -> str:
    name = str(name).strip()
    if not 1 <= len(name) <= 60:
        raise ValueError("a zone name has 1 to 60 characters")
    return name


def _clean_color(color: str) -> str:
    color = str(color).strip().lower()
    if not _HEX.fullmatch(color):
        raise ValueError("a colour is written #rrggbb")
    return color


def _zone(part: dict, zone_id: int) -> dict:
    for zone in part["zones"]:
        if zone["id"] == zone_id:
            return zone
    raise KeyError(zone_id)


def _store(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def create_zone(project: Project, variant_id: str, part_id: str,
                name: str | None = None, color: str | None = None) -> dict:
    with _lock:
        taken = {z["id"] for z in project.part(variant_id, part_id)["zones"]}
        zone_id = next((i for i in range(1, MAX_ZONES + 1) if i not in taken), None)
        if zone_id is None:
            raise ValueError("too many zones")
        zone = {"id": zone_id,
                "name": _clean_name(name) if name is not None else f"Strefa {zone_id}",
                "color": _clean_color(color) if color is not None else PALETTE[(zone_id - 1) % len(PALETTE)]}

        def apply(plan: dict) -> None:
            part = find_part(plan, variant_id, part_id)
            part["zones"] = sorted(part["zones"] + [zone], key=lambda z: z["id"])

        project.update(apply)
        return dict(zone)


def update_zone(project: Project, variant_id: str, part_id: str, zone_id: int,
                name: str | None = None, color: str | None = None) -> dict:
    with _lock:
        changes = {}
        if name is not None:
            changes["name"] = _clean_name(name)
        if color is not None:
            changes["color"] = _clean_color(color)
        _zone(project.part(variant_id, part_id), zone_id)            # KeyError before anything changes
        project.update(lambda plan: _zone(find_part(plan, variant_id, part_id), zone_id).update(changes))
        return _zone(project.part(variant_id, part_id), zone_id)


def read_faces(project: Project, variant_id: str, part_id: str) -> bytes:
    part = project.part(variant_id, part_id)
    path = _faces_path(project, variant_id, part_id)
    if path.exists():
        data = path.read_bytes()
        if len(data) == (part["tris"] or 0):
            return data
    return bytes(part["tris"] or 0)


def _write(project: Project, variant_id: str, part_id: str, data: bytes) -> int:
    _store(_faces_path(project, variant_id, part_id), data)

    def bump(plan: dict) -> None:
        find_part(plan, variant_id, part_id)["zones_rev"] += 1

    project.update(bump)
    return project.part(variant_id, part_id)["zones_rev"]


def write_faces(project: Project, variant_id: str, part_id: str, data: bytes) -> int:
    """Store the zone of every face. Returns the part's new zones_rev."""
    with _lock:
        part = project.part(variant_id, part_id)
        if not part["tris"] or len(data) != part["tris"]:
            raise ValueError("one byte per face is expected")
        allowed = np.array([0] + [z["id"] for z in part["zones"]], dtype=np.uint8)
        if not np.isin(np.frombuffer(data, dtype=np.uint8), allowed).all():
            raise ValueError("the data names a zone this part does not have")
        return _write(project, variant_id, part_id, bytes(data))


def delete_zone(project: Project, variant_id: str, part_id: str, zone_id: int) -> None:
    """Remove the zone; its faces go back to no zone."""
    with _lock:
        _zone(project.part(variant_id, part_id), zone_id)
        faces = np.frombuffer(read_faces(project, variant_id, part_id), dtype=np.uint8).copy()
        faces[faces == zone_id] = 0

        def drop(plan: dict) -> None:
            part = find_part(plan, variant_id, part_id)
            part["zones"] = [z for z in part["zones"] if z["id"] != zone_id]

        project.update(drop)
        _write(project, variant_id, part_id, faces.tobytes())


def resegment(project: Project, variant_id: str, part_id: str, angle: float, min_area_fraction: float) -> dict:
    """Cut the part's patches again with other parameters. Zones are per face and stay as they are."""
    try:
        angle, min_area_fraction = float(angle), float(min_area_fraction)
    except (TypeError, ValueError):
        raise ValueError("angle and min_area_fraction are numbers") from None
    if not 1 <= angle <= 180 or not 0 <= min_area_fraction <= 0.05:
        raise ValueError("angle is 1 to 180 degrees, min_area_fraction 0 to 0.05")
    with _lock:
        part = project.part(variant_id, part_id)
        if part["status"] != "ready":
            raise ValueError("the part is not ready")
        result = analyse_part(project.file(part["mesh"]), project.file(part["mesh_lod"]), angle, min_area_fraction)

        def apply(plan: dict) -> None:
            entry = find_part(plan, variant_id, part_id)
            entry["segmentation"] = {"angle": angle, "min_area_fraction": min_area_fraction}
            entry["patches"] = result["patches"]
            entry["patches_rev"] += 1

        project.update(apply)
        return {"patches": result["patches"], "patches_rev": project.part(variant_id, part_id)["patches_rev"]}
