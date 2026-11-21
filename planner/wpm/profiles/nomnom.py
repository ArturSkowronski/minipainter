"""Nom Nom Figures package layouts.

Three layouts are known:
  <root>/STL/<variant>/*.stl + <root>/Render Images/*.jpg   (current)
  <root>/<variant>/*.stl + <root>/*.jpg                      (older)
  <root>/<Name>_STL/<variant>/*.stl, no images               (repacked)
A flat directory of STLs is a package with one variant.
"""
import os
import re
from pathlib import Path

from wpm.profiles.base import Package, PartFile, Reference, Variant, unique_ids

PROFILE = "nomnom"
_KIND_ORDER = ("split", "unsplit", "miniature", "bust")
_ROLE_ORDER = ("colour", "turntable", "beauty", "parts", "bust", "scale", "other")
_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
_ROLE_PREFIXES = (
    (("colored", "coloured"), "colour"),
    (("turntable",), "turntable"),
    (("bs_", "beautyshot"), "beauty"),
    (("parts", "scaleparts"), "parts"),
    (("bust",), "bust"),
    (("scale",), "scale"),
)


def _children(directory: Path) -> list[os.DirEntry]:
    try:
        with os.scandir(directory) as it:
            return sorted((e for e in it if not e.name.startswith(".")), key=lambda e: e.name)
    except OSError:
        return []


def _is_dir(entry: os.DirEntry) -> bool:
    try:
        return entry.is_dir()
    except OSError:
        return False


def _is_part(entry: os.DirEntry) -> bool:
    name = entry.name.lower()
    return (name.endswith(".stl") and not name.endswith("_supported.stl")
            and not name.startswith("output") and not _is_dir(entry))


def _part_entries(directory: Path) -> list[os.DirEntry]:
    return [e for e in _children(directory) if _is_part(e)]


def _subdirs(directory: Path) -> list[Path]:
    return [Path(e.path) for e in _children(directory) if _is_dir(e) and "presupport" not in e.name.lower()]


def _kind(name: str, part_count: int, flat: bool) -> str:
    lower = name.lower()
    if flat:
        return "split" if part_count > 2 else "unsplit"
    if "split" in lower:
        return "split"
    if "bust" in lower:
        return "bust"
    if "miniature" in lower or re.search(r"(?<!\d)75(?!\d)", lower):
        return "miniature"
    return "unsplit"


def variant_dirs(root: Path) -> tuple[list[Path], Path | None] | None:
    """The variant directories of a package rooted here and their container (None when they sit in root).

    None when root is not a package: no part files within two levels, or variant directories that do
    not form one of the known layouts (which is what a folder of several packages looks like).
    """
    level1 = _subdirs(root)
    direct = [d for d in level1 if _part_entries(d)]
    nested = {d: [s for s in _subdirs(d) if _part_entries(s)] for d in level1 if d not in direct}
    nested = {d: subs for d, subs in nested.items() if subs}
    if _part_entries(root):
        # Flat package. Several part-holding directories below it mean a library with a stray file instead.
        return ([root], None) if len(direct) + sum(map(len, nested.values())) < 2 else None
    if direct and not nested:
        return direct, None
    if not direct and len(nested) == 1:
        (container, subs), = nested.items()
        if "stl" in container.name.lower():
            return subs, container
    return None


def _role(stem: str) -> str:
    lower = stem.lower()
    for prefixes, role in _ROLE_PREFIXES:
        if lower.startswith(prefixes):
            return role
    return "other"


def _references(root: Path) -> tuple[Reference, ...]:
    places = [root] + [d for d in _subdirs(root) if re.search(r"render|image", d.name.lower())]
    files = [Path(e.path) for place in places for e in _children(place)
             if not _is_dir(e) and Path(e.name).suffix.lower() in _IMAGE_SUFFIXES]
    files.sort(key=lambda p: (_ROLE_ORDER.index(_role(p.stem)), p.name.lower()))
    ids = unique_ids([p.stem for p in files])
    return tuple(Reference(id=i, role=_role(p.stem), path=p) for i, p in zip(ids, files))


def scan(root: Path) -> Package | None:
    root = Path(root)
    found = variant_dirs(root)
    if found is None:
        return None
    dirs, _ = found
    flat = dirs == [root]
    rows = []
    for d in dirs:
        entries = _part_entries(d)
        rows.append((d, _kind(d.name, len(entries), flat), entries))
    rows.sort(key=lambda r: (_KIND_ORDER.index(r[1]), r[0].name.lower()))
    variant_ids = unique_ids([d.name for d, _, _ in rows])
    variants = []
    for vid, (d, kind, entries) in zip(variant_ids, rows):
        part_ids = unique_ids([Path(e.name).stem for e in entries])
        parts = sorted((PartFile(id=pid, path=Path(e.path), size=e.stat().st_size)
                        for pid, e in zip(part_ids, entries)), key=lambda p: p.id)
        variants.append(Variant(id=vid, name=d.name, kind=kind, path=d, parts=tuple(parts)))
    return Package(profile=PROFILE, root=root, name=root.name,
                   variants=tuple(variants), references=_references(root))
