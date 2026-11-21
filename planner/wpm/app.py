"""HTTP surface: REST for the page, a revision stream, workspace files, and the static UI."""
import asyncio
import contextlib
import json
from collections.abc import AsyncIterator
from pathlib import Path

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from wpm import zones
from wpm.jobs import Processor
from wpm.profiles import detect
from wpm.workspace import Project, get_project, list_projects

APP_NAME = "warpaint-model"
UI_DIR = Path(__file__).resolve().parent.parent / "ui"
NO_DIRECTORY = "Nie ma takiego katalogu."
IS_ARCHIVE = "To archiwum. Rozpakuj je i wskaż katalog."
NOT_A_PACKAGE = "Nie rozpoznano paczki Nom Nom w tym katalogu."
NOT_FOUND = "Nie znaleziono."
NOT_JSON = "Oczekiwano JSON."
BAD_INPUT = "Nieprawidłowe dane."
CONFLICT = "Strefy zmieniły się w innym miejscu."
LOCAL_HOSTS = ["127.0.0.1", "localhost"]
_BINARY = "application/octet-stream"
_SERVED = {"meshes": {".glb": "model/gltf-binary", ".u32": _BINARY, ".u8": _BINARY, ".json": "application/json"},
           "refs": {".jpg": "image/jpeg"}}
_KEEPALIVE_SECONDS = 15
PART = "/api/projects/{slug}/variants/{variant}/parts/{part}"


class _PageFiles(StaticFiles):
    """The page's own files. `no-cache` makes the browser check on every load that it has the current one."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


async def _body(request: Request) -> dict | None:
    """The JSON object sent, {} if it is not one, None if the request is not JSON at all.

    Requiring a JSON content type keeps other web pages from posting here: a cross-site form or
    "simple" fetch cannot send it without a preflight, which this server never grants.
    """
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        return None
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        return {}
    return body if isinstance(body, dict) else {}


async def plan_events(project: Project) -> AsyncIterator[str]:
    """Server-sent events: the current revision at once, then every new one."""
    loop = asyncio.get_running_loop()
    revisions: asyncio.Queue[int] = asyncio.Queue()

    def on_revision(revision: int) -> None:       # called from worker threads
        with contextlib.suppress(RuntimeError):   # the loop is gone: nobody is listening any more
            loop.call_soon_threadsafe(revisions.put_nowait, revision)

    unsubscribe = project.subscribe(on_revision)
    try:
        yield f"data: {json.dumps({'revision': project.snapshot()['revision']})}\n\n"
        while True:
            try:
                revision = await asyncio.wait_for(revisions.get(), _KEEPALIVE_SECONDS)
            except TimeoutError:
                yield ": keepalive\n\n"
                continue
            yield f"data: {json.dumps({'revision': revision})}\n\n"
    finally:
        unsubscribe()


def create_app(processor: Processor | None = None, allowed_hosts: list[str] | None = None) -> Starlette:
    """`allowed_hosts` adds Host names accepted besides this machine's own (tests use it)."""
    processor = processor or Processor()
    # Refusing foreign Host headers stops DNS-rebinding pages from reading plans and reference images.
    hosts = Middleware(TrustedHostMiddleware, allowed_hosts=LOCAL_HOSTS + (allowed_hosts or []))

    def project_or_none(request: Request) -> Project | None:
        try:
            return get_project(request.path_params["slug"])
        except KeyError:
            return None

    async def health(request: Request):
        return JSONResponse({"app": APP_NAME})

    async def projects(request: Request):
        return JSONResponse(list_projects())

    async def open_project(request: Request):
        body = await _body(request)
        if body is None:
            return _error(415, NOT_JSON)
        raw = body.get("path")
        if not isinstance(raw, str) or not raw.strip():
            return _error(400, NO_DIRECTORY)
        path = Path(raw.strip()).expanduser()
        if path.is_file() and path.suffix.lower() in (".zip", ".rar", ".7z"):
            return _error(400, IS_ARCHIVE)
        if not path.is_dir():
            return _error(400, NO_DIRECTORY)
        found = await asyncio.to_thread(detect, path)
        if found is None:
            return _error(400, NOT_A_PACKAGE)
        package, variant = found
        project = Project.open_or_create(package)
        resume = variant or project.snapshot()["active_variant"]
        if resume:
            processor.enqueue_variant(project, resume, retry=True)
        return JSONResponse({"slug": project.slug, "variant": variant})

    async def plan(request: Request):
        project = project_or_none(request)
        if project is None:
            return _error(404, NOT_FOUND)
        snapshot = project.snapshot()
        if snapshot["active_variant"]:            # picks up work a restart interrupted; a no-op otherwise
            processor.enqueue_variant(project, snapshot["active_variant"])
        return JSONResponse(snapshot)

    async def choose_variant(request: Request):
        project = project_or_none(request)
        if project is None:
            return _error(404, NOT_FOUND)
        body = await _body(request)
        if body is None:
            return _error(415, NOT_JSON)
        try:
            processor.enqueue_variant(project, str(body.get("variant")), retry=True)
        except KeyError:
            return _error(404, NOT_FOUND)
        return JSONResponse({"revision": project.snapshot()["revision"]})

    async def events(request: Request):
        project = project_or_none(request)
        if project is None:
            return _error(404, NOT_FOUND)
        return StreamingResponse(plan_events(project), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    async def workspace_file(request: Request):
        project = project_or_none(request)
        rel = request.path_params["path"]
        media = _SERVED.get(rel.split("/", 1)[0], {}).get(Path(rel).suffix.lower())
        if project is None or media is None:
            return _error(404, NOT_FOUND)
        try:
            target = project.file(rel)
        except ValueError:
            return _error(404, NOT_FOUND)
        if not target.is_file():
            return _error(404, NOT_FOUND)
        return FileResponse(target, media_type=media)

    # -- zones of one part ---------------------------------------------------------------------

    def zone_route(handler):
        """Resolve the project and part of the URL; KeyError becomes 404, ValueError 400."""
        async def route(request: Request):
            project = project_or_none(request)
            if project is None:
                return _error(404, NOT_FOUND)
            where = (project, request.path_params["variant"], request.path_params["part"])
            try:
                return await handler(request, *where)
            except KeyError:
                return _error(404, NOT_FOUND)
            except zones.Conflict:
                return _error(409, CONFLICT)
            except ValueError:
                return _error(400, BAD_INPUT)
        return route

    def zone_id(request: Request) -> int:
        try:
            return int(request.path_params["zone"])
        except ValueError:
            raise KeyError(request.path_params["zone"]) from None

    async def json_body(request: Request) -> dict:
        body = await _body(request)
        if body is None:
            raise ValueError("JSON expected")
        return body

    @zone_route
    async def create_zone(request, project, variant, part):
        body = await json_body(request)
        return JSONResponse(zones.create_zone(project, variant, part, body.get("name"), body.get("color")))

    @zone_route
    async def update_zone(request, project, variant, part):
        body = await json_body(request)
        return JSONResponse(zones.update_zone(project, variant, part, zone_id(request),
                                              body.get("name"), body.get("color")))

    @zone_route
    async def delete_zone(request, project, variant, part):
        zones.delete_zone(project, variant, part, zone_id(request))
        return JSONResponse({"zones_rev": project.part(variant, part)["zones_rev"]})

    @zone_route
    async def get_faces(request, project, variant, part):
        return Response(zones.read_faces(project, variant, part), media_type=_BINARY,
                        headers={"Cache-Control": "no-store"})

    @zone_route
    async def put_faces(request, project, variant, part):
        if request.headers.get("content-type", "").split(";")[0].strip().lower() != _BINARY:
            return _error(415, BAD_INPUT)
        based_on = request.headers.get("if-match")
        base_rev = int(based_on) if based_on is not None else None          # not a number: ValueError, 400
        return JSONResponse({"zones_rev": zones.write_faces(project, variant, part, await request.body(), base_rev)})

    @zone_route
    async def segment(request, project, variant, part):
        body = await json_body(request)
        return JSONResponse(await asyncio.to_thread(
            zones.resegment, project, variant, part, body.get("angle"), body.get("min_area_fraction")))

    @contextlib.asynccontextmanager
    async def lifespan(app: Starlette):
        yield
        processor.shutdown()

    return Starlette(lifespan=lifespan, middleware=[hosts], routes=[
        Route("/api/health", health),
        Route("/api/projects", projects, methods=["GET"]),
        Route("/api/projects", open_project, methods=["POST"]),
        Route("/api/projects/{slug}", plan),
        Route("/api/projects/{slug}/variant", choose_variant, methods=["POST"]),
        Route("/api/projects/{slug}/events", events),
        Route(PART + "/zones", create_zone, methods=["POST"]),
        Route(PART + "/zones/{zone}", update_zone, methods=["PATCH"]),
        Route(PART + "/zones/{zone}", delete_zone, methods=["DELETE"]),
        Route(PART + "/zone-faces", get_faces, methods=["GET"]),
        Route(PART + "/zone-faces", put_faces, methods=["PUT"]),
        Route(PART + "/segment", segment, methods=["POST"]),
        Route("/files/{slug}/{path:path}", workspace_file),
        Mount("/", _PageFiles(directory=UI_DIR, html=True)),
    ])
