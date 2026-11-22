import asyncio
from concurrent.futures import ThreadPoolExecutor

import pytest
from starlette.testclient import TestClient

from tests.packages import flat, spiderman
from wpm.app import create_app, plan_events
from wpm.inventory import Inventory
from wpm.jobs import Processor
from wpm.profiles.nomnom import scan
from wpm.workspace import Project, get_project


@pytest.fixture
def processor():
    p = Processor(ThreadPoolExecutor(max_workers=1))
    yield p
    p.shutdown()


def _paint(pid, fmt, hex_):
    return {"id": pid, "name": pid.title(), "provider": "test", "format": fmt, "hex": hex_}


PAINTS = [_paint("light-red", "opaque_layer", "#e8705a"), _paint("red", "opaque_base", "#b3202a"),
          _paint("red-wash", "wash", "#5a1a1a")]


@pytest.fixture
def client(processor):
    app = create_app(processor, allowed_hosts=["testserver"], inventory=Inventory.fixed(PAINTS))
    with TestClient(app) as c:
        yield c


def test_open_a_package_and_read_its_plan(client, tmp_path):
    root = spiderman(tmp_path / "src")
    r = client.post("/api/projects", json={"path": str(root)})
    assert r.status_code == 200 and r.json()["variant"] is None
    plan = client.get(f"/api/projects/{r.json()['slug']}").json()
    assert plan["name"] == "src" and len(plan["variants"]) == 4
    assert client.get("/api/projects").json()[0]["slug"] == r.json()["slug"]


def test_opening_a_variant_directory_starts_processing_it(client, processor, tmp_path):
    root = spiderman(tmp_path / "src")
    r = client.post("/api/projects", json={"path": str(root / "STL" / "Bust")}).json()
    assert r["variant"] == "bust"
    processor.wait_idle(30)
    plan = client.get(f"/api/projects/{r['slug']}").json()
    assert plan["active_variant"] == "bust"
    assert all(p["status"] == "ready" for v in plan["variants"] if v["id"] == "bust" for p in v["parts"])


def test_choose_variant_then_fetch_a_mesh(client, processor, tmp_path):
    slug = client.post("/api/projects", json={"path": str(flat(tmp_path / "my models ż"))}).json()["slug"]
    vid = client.get(f"/api/projects/{slug}").json()["variants"][0]["id"]
    assert client.post(f"/api/projects/{slug}/variant", json={"variant": vid}).status_code == 200
    processor.wait_idle(30)
    part = client.get(f"/api/projects/{slug}").json()["variants"][0]["parts"][0]
    r = client.get(f"/files/{slug}/{part['mesh']}")
    assert r.status_code == 200 and r.content[:4] == b"glTF" and r.headers["content-type"] == "model/gltf-binary"


def test_reading_a_plan_resumes_its_unfinished_variant(client, processor, tmp_path):
    p = Project.open_or_create(scan(flat(tmp_path / "src")))
    p.update(lambda plan: plan.__setitem__("active_variant", "src"))       # as left by an interrupted run
    client.get(f"/api/projects/{p.slug}")
    assert processor.wait_idle(30)
    assert all(x["status"] == "ready" for x in p.snapshot()["variants"][0]["parts"])


@pytest.mark.parametrize("path,msg", [
    ("/no/such/dir", "Nie ma takiego katalogu."),
    ("ZIP", "To archiwum. Rozpakuj je i wskaż katalog."),
    ("EMPTY", "Nie rozpoznano paczki Nom Nom w tym katalogu.")])
def test_open_errors(client, tmp_path, path, msg):
    (tmp_path / "x.zip").write_bytes(b"PK")
    (tmp_path / "empty").mkdir()
    path = {"ZIP": str(tmp_path / "x.zip"), "EMPTY": str(tmp_path / "empty")}.get(path, path)
    r = client.post("/api/projects", json={"path": path})
    assert r.status_code == 400 and r.json() == {"error": msg}


def test_open_without_a_path_is_refused(client):
    for body in ({}, {"path": ""}, {"path": 5}):
        r = client.post("/api/projects", json=body)
        assert r.status_code == 400 and r.json() == {"error": "Nie ma takiego katalogu."}


def test_not_found_and_traversal(client, tmp_path):
    slug = client.post("/api/projects", json={"path": str(flat(tmp_path / "src"))}).json()["slug"]
    assert client.get("/api/projects/nope").status_code == 404
    assert client.get("/api/projects/nope").json() == {"error": "Nie znaleziono."}
    assert client.post(f"/api/projects/{slug}/variant", json={"variant": "nope"}).status_code == 404
    assert client.get(f"/files/{slug}/..%2F..%2Fplan.json").status_code == 404
    assert client.get(f"/files/{slug}/plan.json").status_code == 404        # only meshes and references are served
    assert client.get(f"/files/{slug}/meshes/missing.glb").status_code == 404


def test_health_and_static(client):
    assert client.get("/api/health").json() == {"app": "warpaint-model"}
    assert "warpaint-model" in client.get("/").text


def test_plan_events_starts_with_the_current_revision_then_follows_updates(tmp_path):
    async def run():
        p = Project.open_or_create(scan(flat(tmp_path / "src")))
        gen = plan_events(p)
        first = await anext(gen)
        p.update(lambda plan: None)
        second = await asyncio.wait_for(anext(gen), 2)
        await gen.aclose()
        return first, second
    first, second = asyncio.run(run())
    assert first == 'data: {"revision": 1}\n\n' and second == 'data: {"revision": 2}\n\n'


def test_reopening_retries_failed_parts(client, processor, tmp_path):
    root = flat(tmp_path / "src")
    project = Project.open_or_create(scan(root))
    (root / "a.stl").rename(root / "a.away")                      # the drive went away
    client.post(f"/api/projects/{project.slug}/variant", json={"variant": "src"})
    processor.wait_idle(30)
    assert project.snapshot()["variants"][0]["parts"][0]["status"] == "error"
    (root / "a.away").rename(root / "a.stl")                      # and came back
    client.get(f"/api/projects/{project.slug}")                   # a page refresh alone does not retry
    processor.wait_idle(30)
    assert project.snapshot()["variants"][0]["parts"][0]["status"] == "error"
    client.post("/api/projects", json={"path": str(root)})        # opening again does
    processor.wait_idle(30)
    assert project.snapshot()["variants"][0]["parts"][0]["status"] == "ready"


def test_deleting_a_parts_meshes_and_reopening_rebuilds_them(client, processor, tmp_path):
    root = flat(tmp_path / "src")
    slug = client.post("/api/projects", json={"path": str(root)}).json()["slug"]
    processor.wait_idle(30)
    project = get_project(slug)
    part = project.snapshot()["variants"][0]["parts"][0]
    project.file(part["mesh"]).unlink()
    project.file(part["mesh_lod"]).unlink()
    client.post("/api/projects", json={"path": str(root)})
    processor.wait_idle(30)
    assert project.snapshot()["variants"][0]["parts"][0]["status"] == "ready" and project.file(part["mesh"]).exists()


def test_a_request_for_another_host_is_refused(client):
    assert client.get("/api/projects", headers={"host": "evil.example"}).status_code == 400
    assert client.get("/api/projects", headers={"host": "127.0.0.1:8770"}).status_code == 200


def test_posts_must_be_json(client, tmp_path):
    body = '{"path": "%s"}' % flat(tmp_path / "src")
    r = client.post("/api/projects", content=body, headers={"content-type": "text/plain"})
    assert r.status_code == 415 and client.get("/api/projects").json() == []


def test_sidecars_are_served(client, processor, tmp_path):
    slug = client.post("/api/projects", json={"path": str(flat(tmp_path / "src"))}).json()["slug"]
    processor.wait_idle(30)
    part = client.get(f"/api/projects/{slug}").json()["variants"][0]["parts"][0]
    base = f"/files/{slug}/{part['mesh'][:-4]}"
    patches = client.get(base + ".patches.u32")
    assert patches.status_code == 200 and patches.headers["content-type"] == "application/octet-stream"
    assert len(patches.content) == 4 * part["tris"]
    assert len(client.get(base + ".masks.u8").content) == 2 * 8
    assert len(client.get(base + ".lodmap.u32").content) == 4 * part["tris_lod"]
    assert len(client.get(base + ".patches.json").json()) == part["patches"]
    assert client.get(f"/files/{slug}/plan.json").status_code == 404


@pytest.fixture
def part_url(client, processor, tmp_path):
    slug = client.post("/api/projects", json={"path": str(flat(tmp_path / "src"))}).json()["slug"]
    processor.wait_idle(30)
    return f"/api/projects/{slug}/variants/src/parts/a"


OCTETS = {"content-type": "application/octet-stream"}


def test_zone_routes(client, part_url):
    zone = client.post(f"{part_url}/zones", json={"name": "Czerwień"}).json()
    assert zone["id"] == 1 and zone["name"] == "Czerwień"
    assert client.patch(f"{part_url}/zones/1", json={"color": "#b3202a"}).json()["color"] == "#b3202a"
    data = bytes([1] * 3 + [0] * 9)
    saved = client.put(f"{part_url}/zone-faces", content=data, headers=OCTETS)
    assert saved.status_code == 200 and saved.json() == {"zones_rev": 1}
    got = client.get(f"{part_url}/zone-faces")
    assert got.content == data and got.headers["content-type"] == "application/octet-stream"
    assert client.delete(f"{part_url}/zones/1").json() == {"zones_rev": 2}
    assert client.get(f"{part_url}/zone-faces").content == bytes(12)


def test_zone_route_errors(client, part_url):
    client.post(f"{part_url}/zones", json={})
    assert client.put(f"{part_url}/zone-faces", content=bytes(12), headers={"content-type": "text/plain"}).status_code == 415
    wrong = client.put(f"{part_url}/zone-faces", content=bytes(5), headers=OCTETS)
    assert wrong.status_code == 400 and wrong.json() == {"error": "Nieprawidłowe dane."}
    assert client.patch(f"{part_url}/zones/1", json={"color": "red"}).status_code == 400
    assert client.patch(f"{part_url}/zones/9", json={"name": "x"}).status_code == 404
    assert client.patch(f"{part_url}/zones/abc", json={"name": "x"}).status_code == 404
    missing = part_url.replace("/parts/a", "/parts/nope")
    assert client.post(f"{missing}/zones", json={}).status_code == 404
    assert client.get(f"{missing}/zone-faces").status_code == 404


def test_segment_route(client, part_url):
    r = client.post(f"{part_url}/segment", json={"angle": 100, "min_area_fraction": 0})
    assert r.status_code == 200 and r.json() == {"patches": 1, "patches_rev": 2}
    assert client.post(f"{part_url}/segment", json={"angle": 500, "min_area_fraction": 0}).status_code == 400
    assert client.post(f"{part_url}/segment", json={}).status_code == 400


def test_zone_faces_conflict(client, part_url):
    client.post(f"{part_url}/zones", json={})
    ok = client.put(f"{part_url}/zone-faces", content=bytes([1] * 12), headers={**OCTETS, "if-match": "0"})
    assert ok.status_code == 200 and ok.json() == {"zones_rev": 1}
    stale = client.put(f"{part_url}/zone-faces", content=bytes(12), headers={**OCTETS, "if-match": "0"})
    assert stale.status_code == 409 and stale.json() == {"error": "Strefy zmieniły się w innym miejscu."}
    assert client.get(f"{part_url}/zone-faces").content == bytes([1] * 12)
    assert client.put(f"{part_url}/zone-faces", content=bytes(12), headers={**OCTETS, "if-match": "x"}).status_code == 400


def test_page_files_are_always_revalidated(client):
    # The page is edited in place; a browser must not keep running last hour's script.
    assert client.get("/").headers["cache-control"] == "no-cache"
    assert client.get("/index.html").headers["cache-control"] == "no-cache"


# -- recipes, steps, progress, inventory ---------------------------------------------------------------

RED = {"name": "Czerwień", "base": "#b3202a", "highlight": "#e8705a"}


def keys(steps):
    return [s["key"] for s in steps]


def test_recipe_routes_and_steps(client, part_url):
    project = part_url.split("/variants/")[0]
    made = client.post(f"{project}/recipes", json=RED)
    assert made.status_code == 200
    recipe, steps = made.json()["recipe"], made.json()["steps"]
    assert recipe["id"] == "r1" and recipe["name"] == "Czerwień" and recipe["layers"] == 2
    assert keys(steps) == ["base", "layer:1", "layer:2", "shade", "highlight"]
    assert steps[0]["paint"]["id"] == "red" and steps[3]["paint"]["id"] == "red-wash"
    assert [m["parts"] for m in steps[1]["mix"]] == [2, 1]

    patched = client.patch(f"{project}/recipes/r1", json={"layers": 3}).json()
    assert patched["recipe"]["layers"] == 3 and keys(patched["steps"])[1:4] == ["layer:1", "layer:2", "layer:3"]
    assert client.get(project).json()["recipes"] == [patched["recipe"]]

    listed = client.get(f"{project}/steps").json()
    assert listed["profile"] == {"id": "layered", "stages": ["primer", "base", "layers", "shade", "lining", "highlight", "ink"]}
    assert listed["recipes"] == {"r1": patched["steps"]}
    assert listed["inventory"]["state"] == "ok" and listed["inventory"]["count"] == 3

    assert client.post(f"{project}/recipes", json={}).json()["recipe"]["id"] == "r2"
    assert client.delete(f"{project}/recipes/r1").json() == {}
    assert list(client.get(f"{project}/steps").json()["recipes"]) == ["r2"]


def test_recipe_route_errors(client, part_url):
    project = part_url.split("/variants/")[0]
    client.post(f"{project}/recipes", json=RED)
    bad = client.post(f"{project}/recipes", json={"layers": 9})
    assert bad.status_code == 400 and bad.json() == {"error": "Nieprawidłowe dane."}
    assert client.patch(f"{project}/recipes/r1", json={"mode": "magic"}).status_code == 400
    assert client.patch(f"{project}/recipes/r9", json={"layers": 1}).status_code == 404
    assert client.delete(f"{project}/recipes/r9").status_code == 404
    assert client.post(f"{project}/recipes", content="name=x", headers={"content-type": "text/plain"}).status_code == 415
    assert client.patch(f"{project}/recipes/r1", content="x", headers={"content-type": "text/plain"}).status_code == 415
    for url in ("/api/projects/nope/steps", "/api/projects/nope/recipes/r1"):
        assert client.get(url).status_code in (404, 405)
    assert client.post("/api/projects/nope/recipes", json={}).status_code == 404
    assert len(client.get(project).json()["recipes"]) == 1


def test_a_zone_is_linked_to_a_recipe(client, part_url):
    project = part_url.split("/variants/")[0]
    client.post(f"{project}/recipes", json=RED)
    client.post(f"{part_url}/zones", json={})
    assert client.patch(f"{part_url}/zones/1", json={"recipe": "r1"}).json()["recipe"] == "r1"
    assert client.patch(f"{part_url}/zones/1", json={"name": "Pas"}).json()["recipe"] == "r1"
    assert client.get(project).json()["variants"][0]["parts"][0]["zones"][0]["recipe"] == "r1"
    assert client.patch(f"{part_url}/zones/1", json={"recipe": "r9"}).status_code == 400
    assert client.patch(f"{part_url}/zones/1", json={"recipe": None}).json()["recipe"] is None


def test_progress_route(client, part_url):
    project = part_url.split("/variants/")[0]
    client.post(f"{project}/recipes", json=RED)
    mark = {"recipe": "r1", "step": "base", "done": True}
    assert client.put(f"{part_url}/progress", json=mark).json() == {"progress": {"r1": ["base"]}}
    assert client.put(f"{part_url}/progress", json=mark).json() == {"progress": {"r1": ["base"]}}
    assert client.get(project).json()["variants"][0]["parts"][0]["progress"] == {"r1": ["base"]}
    assert client.put(f"{part_url}/progress", json={**mark, "done": False}).json() == {"progress": {}}
    assert client.put(f"{part_url}/progress", json={**mark, "step": "primer"}).status_code == 400
    assert client.put(f"{part_url}/progress", json={"recipe": "r1", "step": "base"}).status_code == 400
    assert client.put(f"{part_url}/progress", json={**mark, "recipe": "r9"}).status_code == 404
    assert client.put(f"{part_url}/progress", content="x", headers={"content-type": "text/plain"}).status_code == 415
    assert client.put(part_url.replace("/parts/a", "/parts/nope") + "/progress", json=mark).status_code == 404


def test_settings_route(client, part_url):
    project = part_url.split("/variants/")[0]
    assert client.patch(f"{project}/settings", json={"primer": "#101010"}).json() == {
        "primer": "#101010", "bottle_distance": 0.04}
    assert client.get(project).json()["primer"] == "#101010"
    assert client.patch(f"{project}/settings", json={"primer": "black"}).status_code == 400
    assert client.patch(f"{project}/settings", json={"nope": 1}).status_code == 400
    assert client.patch("/api/projects/nope/settings", json={}).status_code == 404


def test_inventory_routes(client):
    listed = client.get("/api/inventory").json()
    assert listed["paints"] == PAINTS and listed["status"]["state"] == "ok" and listed["status"]["count"] == 3
    again = client.post("/api/inventory/refresh", json={})
    assert again.status_code == 200 and again.json()["paints"] == PAINTS
    assert client.post("/api/inventory/refresh", content="x", headers={"content-type": "text/plain"}).status_code == 415


def test_without_minipainter_the_steps_still_come(processor, tmp_path):
    def broken(command, **options):
        raise FileNotFoundError("node")

    inventory = Inventory(["mpaint"], broken)
    with TestClient(create_app(processor, allowed_hosts=["testserver"], inventory=inventory)) as c:
        slug = c.post("/api/projects", json={"path": str(flat(tmp_path / "src"))}).json()["slug"]
        made = c.post(f"/api/projects/{slug}/recipes", json=RED)
        assert made.status_code == 200 and all(s["paint"] is None for s in made.json()["steps"])
        assert made.json()["steps"][0]["color"] == "#b3202a"
        listed = c.get(f"/api/projects/{slug}/steps").json()
        assert listed["inventory"]["state"] == "error" and listed["inventory"]["error"]
        assert c.get("/api/inventory").json() == {"status": listed["inventory"], "paints": []}


def test_the_inventory_is_read_when_the_server_starts(processor):
    import time
    calls = []

    def runner(command, **options):
        calls.append(command)
        raise FileNotFoundError("node")

    inventory = Inventory(["mpaint"], runner)
    with TestClient(create_app(processor, allowed_hosts=["testserver"], inventory=inventory)):
        deadline = time.monotonic() + 5
        while inventory.status()["state"] == "unread" and time.monotonic() < deadline:
            time.sleep(0.01)
        assert calls == [["mpaint"]]


def test_an_app_built_without_an_inventory_runs_nothing(processor, tmp_path):
    with TestClient(create_app(processor, allowed_hosts=["testserver"])) as c:
        assert c.get("/api/inventory").json() == {
            "status": {"state": "ok", "count": 0, "catalogue": 0, "loaded": None, "error": None}, "paints": []}


OTHERS = [_paint("blue", "opaque_layer", "#2a5caa"), _paint("sky", "opaque_layer", "#6493de")]


def test_the_shopping_list_is_for_the_recipes_in_use(processor, tmp_path):
    inventory = Inventory.fixed(PAINTS, others=OTHERS)
    with TestClient(create_app(processor, allowed_hosts=["testserver"], inventory=inventory)) as c:
        slug = c.post("/api/projects", json={"path": str(flat(tmp_path / "src"))}).json()["slug"]
        processor.wait_idle(30)
        project, part = f"/api/projects/{slug}", f"/api/projects/{slug}/variants/src/parts/a"
        c.post(f"{project}/recipes", json=RED)
        c.post(f"{project}/recipes", json={"name": "Błękit", "base": "#2a5caa", "layers": 0, "use": {"highlight": False}})

        # No zone uses a recipe yet: all of them are looked at.
        answer = c.get(f"{project}/missing").json()
        assert [r["id"] for r in answer["recipes"]] == ["r1", "r2"] and answer["unused"] == []
        assert [(g["recipe"], g["key"], g["reason"], g["pick"]) for g in answer["gaps"]] == [("r2", "base", "far", "blue")]
        assert answer["buy"] == [{"paint": OTHERS[0], "grade": "missing", "for": [{"recipe": "r2", "keys": ["base"]}]}]
        assert answer["inventory"]["count"] == 3 and answer["inventory"]["catalogue"] == 5

        # Once zones use recipes, only those are worth a purchase.
        c.post(f"{part}/zones", json={"name": "Pas"})
        c.patch(f"{part}/zones/1", json={"recipe": "r1"})
        answer = c.get(f"{project}/missing").json()
        assert answer["recipes"] == [{"id": "r1", "name": "Czerwień", "base": "#b3202a", "zones": [{"part": "a", "zone": "Pas"}]}]
        assert answer["unused"] == ["Błękit"] and answer["gaps"] == [] and answer["buy"] == []
        assert c.get("/api/projects/nope/missing").status_code == 404
