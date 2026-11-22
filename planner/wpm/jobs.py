"""Background processing: fills a project's workspace with meshes and reference images.

One item runs at a time. The heavy work happens in a worker process so the server stays responsive.
"""
import json
import logging
import queue
import threading
from concurrent.futures import BrokenExecutor, Executor, ProcessPoolExecutor
from pathlib import Path

from wpm.analysis import ANALYSIS_VERSION, analyse_part, analysis_files
from wpm.glb import read_glb
from wpm.pipeline import bbox_of, process_part
from wpm.refs import prepare_reference
from wpm.stl import StlError
from wpm.workspace import Project, find_outliers, find_part

_STOP = object()
log = logging.getLogger(__name__)


def _do_part(src: str, mesh: str, lod: str, angle: float, min_area_fraction: float) -> dict:
    """Runs in the worker process: plain values in, plain values out."""
    result = process_part(Path(src), Path(mesh), Path(lod))
    analysis = analyse_part(Path(mesh), Path(lod), angle, min_area_fraction)
    return {"tris_source": result.tris_source, "tris": result.tris, "tris_lod": result.tris_lod,
            "bbox": [list(result.bbox[0]), list(result.bbox[1])], "patches": analysis["patches"]}


def _do_analysis(mesh: str, lod: str, angle: float, min_area_fraction: float) -> dict:
    """For a mesh that already exists (it is frozen): only the sidecars are written."""
    analysis = analyse_part(Path(mesh), Path(lod), angle, min_area_fraction)
    vertices, faces = read_glb(Path(mesh))
    return {"tris": len(faces), "tris_lod": len(read_glb(Path(lod))[1]),
            "bbox": [list(b) for b in bbox_of(vertices)], "patches": analysis["patches"]}


def _do_reference(src: str, dst: str) -> dict:
    prepare_reference(Path(src), Path(dst))
    return {}


def _message(error: Exception) -> str:
    return str(error) if isinstance(error, StlError) else f"{type(error).__name__}: {error}"


class Processor:
    def __init__(self, executor: Executor | None = None):
        self._owns_executor = executor is None
        self._executor = executor or ProcessPoolExecutor(max_workers=1)
        self._queue: queue.Queue = queue.Queue()
        self._waiting: set[tuple] = set()          # items queued or running
        self._lock = threading.Lock()
        self._idle = threading.Event()
        self._idle.set()
        self._thread = threading.Thread(target=self._work, name="wpm-processor", daemon=True)
        self._thread.start()

    # -- public -------------------------------------------------------------------------------

    def enqueue_variant(self, project: Project, variant_id: str, retry: bool = False) -> None:
        """Make this the active variant and queue what it still needs. KeyError for an unknown variant.

        `retry` is for explicit user actions (open, choose): failed items get another try and deleted
        meshes are rebuilt. Background resumes leave failures alone, or they would retry forever.
        """
        if retry:
            project.recheck()
        plan = project.snapshot()
        variant = next((v for v in plan["variants"] if v["id"] == variant_id), None)
        if variant is None:
            raise KeyError(variant_id)
        if plan["active_variant"] != variant_id:
            project.update(lambda p: p.__setitem__("active_variant", variant_id))
        items = [("ref", None, r["id"]) for r in plan["references"] if r["status"] == "pending"]
        parts = sorted((p for p in variant["parts"] if p["status"] == "pending"), key=lambda p: p["size"] or 0)
        items += [("part", variant_id, p["id"]) for p in parts]
        with self._lock:
            for kind, vid, item_id in items:
                key = (project.slug, kind, vid, item_id)
                if key not in self._waiting:
                    self._waiting.add(key)
                    self._idle.clear()
                    self._queue.put((project, kind, vid, item_id))

    def wait_idle(self, timeout: float | None = None) -> bool:
        return self._idle.wait(timeout)

    def shutdown(self) -> None:
        self._queue.put(_STOP)
        self._executor.shutdown(wait=False, cancel_futures=True)

    # -- worker thread ------------------------------------------------------------------------

    def _work(self) -> None:
        while True:
            job = self._queue.get()
            if job is _STOP:
                return
            project, kind, variant_id, item_id = job
            try:
                if kind == "part":
                    self._run_part(project, variant_id, item_id)
                    self._settle(project, variant_id)
                else:
                    self._run_reference(project, item_id)
            except Exception:           # never let one item kill the queue
                log.exception("processing %s %s of %s failed", kind, item_id, project.slug)
            finally:
                with self._lock:
                    self._waiting.discard((project.slug, kind, variant_id, item_id))
                    if not self._waiting:
                        self._idle.set()

    def _submit(self, fn, *args) -> dict:
        try:
            return self._executor.submit(fn, *args).result()
        except BrokenExecutor:
            if self._owns_executor:      # the worker process died (out of memory, killed); start a new one
                self._executor = ProcessPoolExecutor(max_workers=1)
            raise RuntimeError("the processing worker stopped unexpectedly") from None

    def _run_part(self, project: Project, variant_id: str, part_id: str) -> None:
        def find(plan: dict) -> dict:
            return find_part(plan, variant_id, part_id)

        def finish(stats: dict) -> None:
            def apply(plan: dict) -> None:
                entry = find(plan)
                entry.update(status="ready", error=None, analysis=ANALYSIS_VERSION, **stats)
                entry["patches_rev"] += 1
            project.update(apply)

        part = find(project.snapshot())
        if part["status"] != "pending":
            return
        mesh, lod = project.file(part["mesh"]), project.file(part["mesh_lod"])
        cut = (part["segmentation"]["angle"], part["segmentation"]["min_area_fraction"])
        if mesh.exists() and lod.exists():
            # Frozen: a mesh that exists is never regenerated. At most its analysis is (re)done.
            sidecars = analysis_files(mesh)
            if part["analysis"] == ANALYSIS_VERSION and all(f.exists() for f in sidecars.values()):
                vertices, faces = read_glb(mesh)
                stats = {"tris": len(faces), "tris_lod": len(read_glb(lod)[1]),
                         "bbox": [list(b) for b in bbox_of(vertices)],
                         "patches": len(json.loads(sidecars["stats"].read_text()))}
                project.update(lambda p: find(p).update(status="ready", error=None, **stats))
                return
            job = (_do_analysis, str(mesh), str(lod), *cut)
        elif not Path(part["source"]).exists():
            project.update(lambda p: find(p).update(status="error", error="source file is missing"))
            return
        else:
            job = (_do_part, part["source"], str(mesh), str(lod), *cut)
        project.update(lambda p: find(p).update(status="processing", error=None))
        try:
            stats = self._submit(*job)
        except Exception as error:
            message = _message(error)
            project.update(lambda p: find(p).update(status="error", error=message))
        else:
            finish(stats)

    def _run_reference(self, project: Project, ref_id: str) -> None:
        def find(plan: dict) -> dict:
            return next(r for r in plan["references"] if r["id"] == ref_id)

        ref = find(project.snapshot())
        if ref["status"] != "pending":
            return
        target = project.file(ref["file"])
        if target.exists():
            project.update(lambda p: find(p).update(status="ready", error=None))
            return
        if not Path(ref["source"]).exists():
            project.update(lambda p: find(p).update(status="error", error="source file is missing"))
            return
        try:
            self._submit(_do_reference, ref["source"], str(target))
        except Exception as error:
            message = _message(error)
            project.update(lambda p: find(p).update(status="error", error=message))
        else:
            project.update(lambda p: find(p).update(status="ready", error=None))

    def _settle(self, project: Project, variant_id: str) -> None:
        """Once nothing in the variant is waiting, flag parts that do not belong to the figure."""
        variant = next(v for v in project.snapshot()["variants"] if v["id"] == variant_id)
        if any(p["status"] in ("pending", "processing") for p in variant["parts"]):
            return
        boxes = {p["id"]: p["bbox"] for p in variant["parts"] if p["status"] == "ready" and p["bbox"]}
        outliers = find_outliers(boxes)
        if {p["id"] for p in variant["parts"] if p["outlier"]} == outliers:
            return

        def apply(plan: dict) -> None:
            for p in next(v for v in plan["variants"] if v["id"] == variant_id)["parts"]:
                p["outlier"] = p["id"] in outliers

        project.update(apply)
