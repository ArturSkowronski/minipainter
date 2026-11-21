import asyncio
from concurrent.futures import ThreadPoolExecutor

import pytest
from starlette.testclient import TestClient

from tests.packages import flat, spiderman
from wpm.app import create_app, plan_events
from wpm.jobs import Processor
from wpm.profiles.nomnom import scan
from wpm.workspace import Project


@pytest.fixture
def processor():
    p = Processor(ThreadPoolExecutor(max_workers=1))
    yield p
    p.shutdown()


@pytest.fixture
def client(processor):
    with TestClient(create_app(processor)) as c:
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
