import asyncio
from concurrent.futures import ThreadPoolExecutor

import pytest
from starlette.testclient import TestClient

from tests.packages import flat, spiderman
from wpm.app import create_app, plan_events
from wpm.jobs import Processor
from wpm.profiles.nomnom import scan
from wpm.workspace import Project, get_project


@pytest.fixture
def processor():
    p = Processor(ThreadPoolExecutor(max_workers=1))
    yield p
    p.shutdown()


@pytest.fixture
def client(processor):
    with TestClient(create_app(processor, allowed_hosts=["testserver"])) as c:
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
