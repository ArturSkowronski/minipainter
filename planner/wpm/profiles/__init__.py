"""Find the package a path belongs to."""
from pathlib import Path

from wpm.profiles import nomnom
from wpm.profiles.base import Package


def _within(path: Path, directory: Path) -> bool:
    return path == directory or directory in path.parents


def detect(path: Path) -> tuple[Package, str | None] | None:
    """Return the package and the id of the variant the path points into (None if it points at none).

    The path may be the package root, its STL container, a variant directory or something inside one.
    """
    try:
        path = Path(path).expanduser().resolve()
    except OSError:
        return None
    if not path.is_dir():
        return None

    package = None
    for ancestor in (path.parent.parent, path.parent):          # highest first
        found = nomnom.variant_dirs(ancestor)
        if found is None:
            continue
        dirs, container = found
        if len(dirs) >= 2 and (path == container or any(_within(path, d) for d in dirs)):
            package = nomnom.scan(ancestor)
            break
    if package is None:
        package = nomnom.scan(path)
    if package is None:
        return None

    if len(package.variants) == 1:
        return package, package.variants[0].id
    for variant in package.variants:
        if _within(path, variant.path):
            return package, variant.id
    return package, None
