"""Types every package profile produces."""
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

VariantKind = Literal["split", "unsplit", "miniature", "bust"]
RefRole = Literal["colour", "turntable", "beauty", "parts", "bust", "scale", "other"]


@dataclass(frozen=True)
class PartFile:
    id: str
    path: Path
    size: int


@dataclass(frozen=True)
class Variant:
    id: str
    name: str
    kind: VariantKind
    path: Path
    parts: tuple[PartFile, ...]


@dataclass(frozen=True)
class Reference:
    id: str
    role: RefRole
    path: Path


@dataclass(frozen=True)
class Package:
    profile: str
    root: Path
    name: str
    variants: tuple[Variant, ...]
    references: tuple[Reference, ...]


def slugify(text: str) -> str:
    """Lowercase ASCII letters, digits and '-'; never empty."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-") or "x"


def unique_ids(names: list[str]) -> list[str]:
    """Slug per name, in the given order; a repeated slug gets -2, -3, ..."""
    seen: dict[str, int] = {}
    out = []
    for name in names:
        slug = slugify(name)
        seen[slug] = seen.get(slug, 0) + 1
        out.append(slug if seen[slug] == 1 else f"{slug}-{seen[slug]}")
    taken = set()
    for i, slug in enumerate(out):          # "a-2" may itself collide with a file really named "a 2"
        while slug in taken:
            slug += "-x"
        taken.add(slug)
        out[i] = slug
    return out
