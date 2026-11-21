"""Project workspaces: data/projects/<slug>/ with plan.json and everything derived from a package.

The package's own directory is never written to.
"""
import copy
import datetime as dt
import hashlib
import json
import os
import threading
from collections.abc import Callable
from pathlib import Path

from wpm.analysis import DEFAULT_ANGLE, DEFAULT_MIN_AREA_FRACTION, analysis_files
from wpm.profiles.base import Package, slugify

PLAN_VERSION = 2
_projects: dict[str, "Project"] = {}
_registry_lock = threading.Lock()


def data_dir() -> Path:
    override = os.environ.get("WPM_DATA_DIR")
    return Path(override) if override else Path(__file__).resolve().parent.parent / "data"


def projects_dir() -> Path:
    return data_dir() / "projects"


def project_slug(root: Path) -> str:
    digest = hashlib.sha1(str(Path(root).resolve()).encode()).hexdigest()[:8]
    return f"{slugify(Path(root).name)}-{digest}"


def _zone_fields() -> dict:
    """What version 2 added to every part: its patches and its zones."""
    return {"patches": None, "patches_rev": 0,
            "segmentation": {"angle": DEFAULT_ANGLE, "min_area_fraction": DEFAULT_MIN_AREA_FRACTION},
            "zones": [], "zones_rev": 0}


def _part_entry(variant_id: str, part) -> dict:
    return {
        "id": part.id, "name": part.path.stem, "source": str(part.path), "size": part.size,
        "status": "pending", "error": None, "outlier": False,
        "mesh": f"meshes/{variant_id}/{part.id}.glb", "mesh_lod": f"meshes/{variant_id}/{part.id}.lod.glb",
        "tris_source": None, "tris": None, "tris_lod": None, "bbox": None,
        **_zone_fields(),
    }


def migrate(plan: dict) -> bool:
    """Bring an older plan up to PLAN_VERSION in place. Returns whether anything changed."""
    changed = plan.get("version") != PLAN_VERSION
    for variant in plan["variants"]:
        for part in variant["parts"]:
            for key, value in _zone_fields().items():
                if key not in part:
                    part[key] = value
                    changed = True
    plan["version"] = PLAN_VERSION
    return changed


def find_part(plan: dict, variant_id: str, part_id: str) -> dict:
    """The live part entry inside a plan. KeyError when the variant or the part is unknown."""
    for variant in plan["variants"]:
        if variant["id"] == variant_id:
            for part in variant["parts"]:
                if part["id"] == part_id:
                    return part
    raise KeyError((variant_id, part_id))


def _reference_entry(ref) -> dict:
    return {"id": ref.id, "role": ref.role, "source": str(ref.path),
            "file": f"refs/{ref.id}.jpg", "status": "pending", "error": None}


def _merge(plan: dict, package: Package) -> bool:
    """Add variants, parts and references that appeared on disk; existing entries keep every field."""
    changed = False
    known_refs = {r["id"] for r in plan["references"]}
    for ref in package.references:
        if ref.id not in known_refs:
            plan["references"].append(_reference_entry(ref))
            changed = True
    variants = {v["id"]: v for v in plan["variants"]}
    for variant in package.variants:
        entry = variants.get(variant.id)
        if entry is None:
            entry = {"id": variant.id, "name": variant.name, "kind": variant.kind, "parts": []}
            plan["variants"].append(entry)
            changed = True
        known_parts = {p["id"] for p in entry["parts"]}
        for part in variant.parts:
            if part.id not in known_parts:
                entry["parts"].append(_part_entry(variant.id, part))
                changed = True
    return changed


class Project:
    def __init__(self, slug: str, plan: dict):
        self.slug = slug
        self.dir = projects_dir() / slug
        self._plan = plan
        self._lock = threading.RLock()
        self._subscribers: list[Callable[[int], None]] = []

    # -- construction -------------------------------------------------------------------------

    @classmethod
    def open_or_create(cls, package: Package) -> "Project":
        slug = project_slug(package.root)
        with _registry_lock:
            project = _projects.get(slug)
            if project is None and (projects_dir() / slug / "plan.json").exists():
                project = _projects[slug] = cls._read(slug)
            if project is None:
                plan = {"version": PLAN_VERSION, "revision": 1, "profile": package.profile,
                        "name": package.name, "source": str(package.root), "active_variant": None,
                        "references": [], "variants": []}
                _merge(plan, package)
                project = _projects[slug] = cls(slug, plan)
                project._save()
                return project
        changed = []
        with project._lock:
            if _merge(project._plan, package):
                changed.append(project._commit())
        for revision in changed:
            project._notify(revision)
        return project

    @classmethod
    def load(cls, slug: str) -> "Project":
        """Read a project from disk. Raises KeyError when there is no such project."""
        with _registry_lock:
            project = _projects.get(slug)
            if project is None:
                project = _projects[slug] = cls._read(slug)
            return project

    @classmethod
    def _read(cls, slug: str) -> "Project":
        path = projects_dir() / slug / "plan.json"
        if slug != slugify(slug) or not path.exists():
            raise KeyError(slug)
        project = cls(slug, json.loads(path.read_text()))
        migrate(project._plan)
        project._reset_stale(("processing", "error"))     # after a restart nothing is running
        # Always a new revision: a page left open across the restart refetches and so resumes the work.
        project._commit()
        return project

    def _reset_stale(self, statuses: tuple[str, ...]) -> bool:
        """Back to 'pending': items in the given statuses, and 'ready' items whose file is gone."""
        changed = False

        def complete(item: dict) -> bool:
            if "file" in item:                                    # a reference image
                return (self.dir / item["file"]).exists()
            mesh = self.dir / item["mesh"]
            return (mesh.exists() and (self.dir / item["mesh_lod"]).exists()
                    and all(f.exists() for f in analysis_files(mesh).values()))

        items = [p for v in self._plan["variants"] for p in v["parts"]] + self._plan["references"]
        for item in items:
            stale = item["status"] in statuses or (item["status"] == "ready" and not complete(item))
            if stale:
                item["status"], item["error"] = "pending", None
                changed = True
        return changed

    def recheck(self) -> bool:
        """Give failed items another try and notice deleted files. Running work is left alone.

        Called when the user opens the project or picks a variant. Returns whether anything changed.
        """
        with self._lock:
            if not self._reset_stale(("error",)):
                return False
            revision = self._commit()
        self._notify(revision)
        return True

    # -- state --------------------------------------------------------------------------------

    def snapshot(self) -> dict:
        with self._lock:
            return copy.deepcopy(self._plan)

    def update(self, fn: Callable[[dict], None]) -> int:
        """Mutate the plan under the lock, bump the revision, save, notify. Returns the new revision."""
        with self._lock:
            fn(self._plan)
            revision = self._commit()
        self._notify(revision)
        return revision

    def part(self, variant_id: str, part_id: str) -> dict:
        """A copy of one part's entry. KeyError when unknown."""
        with self._lock:
            return copy.deepcopy(find_part(self._plan, variant_id, part_id))

    def subscribe(self, callback: Callable[[int], None]) -> Callable[[], None]:
        with self._lock:
            self._subscribers.append(callback)

        def unsubscribe() -> None:
            with self._lock:
                if callback in self._subscribers:
                    self._subscribers.remove(callback)

        return unsubscribe

    def file(self, rel: str) -> Path:
        """A path inside the workspace. ValueError if `rel` would leave it."""
        base = self.dir.resolve()
        target = (base / rel).resolve()
        if Path(rel).is_absolute() or base not in target.parents:
            raise ValueError(rel)
        return self.dir / rel

    def _commit(self) -> int:
        self._plan["revision"] += 1
        self._save()
        return self._plan["revision"]

    def _notify(self, revision: int) -> None:
        with self._lock:
            subscribers = list(self._subscribers)
        for callback in subscribers:
            callback(revision)

    def _save(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.dir / "plan.json.tmp"
        tmp.write_text(json.dumps(self._plan, indent=1, ensure_ascii=False))
        os.replace(tmp, self.dir / "plan.json")


def get_project(slug: str) -> Project:
    """The shared instance for this slug. Raises KeyError when there is no such project."""
    return Project.load(slug)


def list_projects() -> list[dict]:
    """Known projects, most recently changed first."""
    rows = []
    for plan_path in projects_dir().glob("*/plan.json"):
        try:
            plan = json.loads(plan_path.read_text())
            mtime = plan_path.stat().st_mtime
        except (OSError, ValueError):
            continue
        rows.append((mtime, {
            "slug": plan_path.parent.name, "name": plan.get("name"), "source": plan.get("source"),
            "updated": dt.datetime.fromtimestamp(mtime, dt.timezone.utc).isoformat(timespec="seconds")}))
    return [row for _, row in sorted(rows, key=lambda r: r[0], reverse=True)]


def _largest_dimension(boxes) -> float:
    lo = [min(b[0][i] for b in boxes) for i in range(3)]
    hi = [max(b[1][i] for b in boxes) for i in range(3)]
    return max(h - l for l, h in zip(lo, hi))


def find_outliers(bboxes: dict[str, tuple]) -> set[str]:
    """Parts far larger than everything else put together, such as a redistributor's text banner."""
    if len(bboxes) < 3:
        return set()
    return {part for part, box in bboxes.items()
            if _largest_dimension([box]) > 1.5 * _largest_dimension([b for p, b in bboxes.items() if p != part])}
