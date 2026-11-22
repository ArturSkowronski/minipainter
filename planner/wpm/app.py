"""HTTP surface: REST for the page, a revision stream, workspace files, and the static UI."""
import asyncio
import contextlib
import json
import threading
from collections.abc import AsyncIterator
from pathlib import Path

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from wpm import layers, recipes, shopping, zones
from wpm.inventory import Inventory
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


class _NotJson(Exception):
    """The request body is not JSON at all."""


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


def create_app(processor: Processor | None = None, allowed_hosts: list[str] | None = None,
               inventory: Inventory | None = None) -> Starlette:
    """`allowed_hosts` adds Host names accepted besides this machine's own (tests use it).

    Without an `inventory` the app knows no paints and runs no command; `server.py` passes the real one.
    """
    processor = processor or Processor()
    inventory = inventory or Inventory.fixed([])
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

    def project_route(handler):
        """Resolve the project of the URL; KeyError becomes 404, ValueError 400, a non-JSON body 415."""
        async def route(request: Request):
            project = project_or_none(request)
            if project is None:
                return _error(404, NOT_FOUND)
            try:
                return await handler(request, project)
            except KeyError:
                return _error(404, NOT_FOUND)
            except zones.Conflict:
                return _error(409, CONFLICT)
            except _NotJson:
                return _error(415, NOT_JSON)
            except ValueError:
                return _error(400, BAD_INPUT)
        return route

    def zone_route(handler):
        """The same for the routes of one part."""
        async def route(request: Request, project: Project):
            return await handler(request, project, request.path_params["variant"], request.path_params["part"])
        return project_route(route)

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

    async def strict_json(request: Request) -> dict:
        body = await _body(request)
        if body is None:
            raise _NotJson()
        return body

    # -- recipes and what they resolve to --------------------------------------------------------

    async def resolved(project: Project, only: str | None = None) -> dict[str, list]:
        """Recipe id -> its steps, with the paints owned right now."""
        paints = await asyncio.to_thread(inventory.paints)        # the first call may run minipainter
        plan = project.snapshot()
        return {r["id"]: layers.resolve(r, paints, plan["stage_profile"], plan["bottle_distance"])
                for r in plan["recipes"] if only in (None, r["id"])}

    async def with_steps(project: Project, recipe: dict) -> JSONResponse:
        return JSONResponse({"recipe": recipe, "steps": (await resolved(project, recipe["id"]))[recipe["id"]]})

    @project_route
    async def steps(request, project):
        profile = layers.STAGE_PROFILES[project.snapshot()["stage_profile"]]
        return JSONResponse({"profile": profile, "recipes": await resolved(project), "inventory": inventory.status()})

    @project_route
    async def missing(request, project):
        """What to buy for the recipes the zones use (for all of them while no zone uses any)."""
        paints = await asyncio.to_thread(inventory.paints)
        others = await asyncio.to_thread(inventory.others)
        plan = project.snapshot()
        zones_of: dict[str, list[dict]] = {}
        for variant in plan["variants"]:
            for part in variant["parts"]:
                for zone in part["zones"]:
                    if zone.get("recipe"):
                        zones_of.setdefault(zone["recipe"], []).append({"part": part["name"], "zone": zone["name"]})
        used = [r for r in plan["recipes"] if r["id"] in zones_of] or plan["recipes"]
        answer = await asyncio.to_thread(shopping.recommend, used, paints, others, plan["stage_profile"], plan["bottle_distance"])
        return JSONResponse({
            **answer, "inventory": inventory.status(),
            "recipes": [{"id": r["id"], "name": r["name"], "base": r["base"], "zones": zones_of.get(r["id"], [])} for r in used],
            "unused": [r["name"] for r in plan["recipes"] if r not in used]})

    @project_route
    async def create_recipe(request, project):
        return await with_steps(project, recipes.create_recipe(project, await strict_json(request)))

    @project_route
    async def update_recipe(request, project):
        changes = await strict_json(request)
        return await with_steps(project, recipes.update_recipe(project, request.path_params["recipe"], changes))

    @project_route
    async def delete_recipe(request, project):
        recipes.delete_recipe(project, request.path_params["recipe"])
        return JSONResponse({})

    @project_route
    async def settings(request, project):
        return JSONResponse(recipes.update_settings(project, await strict_json(request)))

    async def inventory_list(request: Request):
        paints = await asyncio.to_thread(inventory.paints)
        return JSONResponse({"status": inventory.status(), "paints": paints})

    async def inventory_refresh(request: Request):
        if await _body(request) is None:
            return _error(415, NOT_JSON)
        await asyncio.to_thread(inventory.refresh)
        return JSONResponse({"status": inventory.status(), "paints": inventory.paints()})

    @zone_route
    async def create_zone(request, project, variant, part):
        body = await json_body(request)
        return JSONResponse(zones.create_zone(project, variant, part, body.get("name"), body.get("color")))

    @zone_route
    async def update_zone(request, project, variant, part):
        body = await json_body(request)
        return JSONResponse(zones.update_zone(project, variant, part, zone_id(request), body.get("name"),
                                              body.get("color"), body.get("recipe", zones.UNSET)))

    @zone_route
    async def put_progress(request, project, variant, part):
        body = await strict_json(request)
        return JSONResponse({"progress": recipes.set_progress(
            project, variant, part, body.get("recipe"), body.get("step"), body.get("done"))})

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
        # Read the owned paints now, off the event loop, so the first recipe does not wait for it.
        threading.Thread(target=inventory.paints, name="wpm-inventory", daemon=True).start()
        yield
        processor.shutdown()

    return Starlette(lifespan=lifespan, middleware=[hosts], routes=[
        Route("/api/health", health),
        Route("/api/projects", projects, methods=["GET"]),
        Route("/api/projects", open_project, methods=["POST"]),
        Route("/api/projects/{slug}", plan),
        Route("/api/projects/{slug}/variant", choose_variant, methods=["POST"]),
        Route("/api/projects/{slug}/events", events),
        Route("/api/inventory", inventory_list, methods=["GET"]),
        Route("/api/inventory/refresh", inventory_refresh, methods=["POST"]),
        Route("/api/projects/{slug}/steps", steps, methods=["GET"]),
        Route("/api/projects/{slug}/missing", missing, methods=["GET"]),
        Route("/api/projects/{slug}/recipes", create_recipe, methods=["POST"]),
        Route("/api/projects/{slug}/recipes/{recipe}", update_recipe, methods=["PATCH"]),
        Route("/api/projects/{slug}/recipes/{recipe}", delete_recipe, methods=["DELETE"]),
        Route("/api/projects/{slug}/settings", settings, methods=["PATCH"]),
        Route(PART + "/progress", put_progress, methods=["PUT"]),
        Route(PART + "/zones", create_zone, methods=["POST"]),
        Route(PART + "/zones/{zone}", update_zone, methods=["PATCH"]),
        Route(PART + "/zones/{zone}", delete_zone, methods=["DELETE"]),
        Route(PART + "/zone-faces", get_faces, methods=["GET"]),
        Route(PART + "/zone-faces", put_faces, methods=["PUT"]),
        Route(PART + "/segment", segment, methods=["POST"]),
        Route("/files/{slug}/{path:path}", workspace_file),
        Mount("/", _PageFiles(directory=UI_DIR, html=True)),
    ])
