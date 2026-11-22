import json
import subprocess
from types import SimpleNamespace

from wpm import inventory
from wpm.inventory import Inventory

ITEMS = [
    {"id": "ak/ducat-blue", "name": "Ducat Blue", "provider": "ak_interactive", "owned": True,
     "product_format": "opaque_base", "rgb": {"r": 43, "g": 132, "b": 162}, "usage_roles": ["base"]},
    {"id": "c/abaddon-black", "name": "Abaddon Black", "provider": "citadel", "owned": True,
     "product_format": "opaque_base", "rgb": {"r": 0, "g": 0, "b": 0}},
    {"id": "c/not-owned", "name": "Not Owned", "provider": "citadel", "owned": False,
     "product_format": "opaque_base", "rgb": {"r": 1, "g": 2, "b": 3}},
    {"id": "c/no-colour", "name": "No Colour", "provider": "citadel", "owned": True, "product_format": "wash"},
    {"id": "c/no-format", "name": "No Format", "provider": "citadel", "owned": True,
     "product_format": None, "rgb": {"r": 1, "g": 2, "b": 3}},
    "not a paint",
]
EXPECTED = [
    {"id": "c/abaddon-black", "name": "Abaddon Black", "provider": "citadel", "format": "opaque_base", "hex": "#000000"},
    {"id": "ak/ducat-blue", "name": "Ducat Blue", "provider": "ak_interactive", "format": "opaque_base", "hex": "#2b84a2"},
]


def test_parse_keeps_owned_paints_with_a_format_and_a_colour():
    assert inventory.parse(json.dumps({"message": "89 paints", "items": ITEMS})) == EXPECTED
    assert inventory.parse(json.dumps(ITEMS)) == EXPECTED
    assert inventory.parse('{"items": []}') == [] and inventory.parse("[]") == []


def test_json_of_another_shape_is_not_an_empty_inventory():
    # An older mpaint, or an error object, must read as "could not read", not as "owns nothing".
    import pytest
    unusable = [{"id": "c/x", "name": "X", "owned": True, "rgb": "#010203", "product_format": "wash"},
                {"id": "c/y", "name": "Y", "owned": True, "rgb": {"r": 1, "g": 2, "b": 3}}]
    for text in ("{}", '{"error": "no such command"}', '{"items": "none"}', json.dumps(unusable), '"text"', "12"):
        with pytest.raises(ValueError):
            inventory.parse(text)


class Runner:
    def __init__(self, *results):
        self.results = list(results)
        self.calls = []

    def __call__(self, command, **options):
        self.calls.append((command, options))
        result = self.results.pop(0) if len(self.results) > 1 else self.results[0]
        if isinstance(result, Exception):
            raise result
        return result


def ok():
    return SimpleNamespace(returncode=0, stdout=json.dumps({"items": ITEMS}), stderr="")


def test_the_command_runs_once_and_again_on_refresh():
    runner = Runner(ok())
    inv = Inventory(["mpaint", "inventory", "list", "--json"], runner)
    assert inv.status()["state"] == "unread" and runner.calls == []
    assert inv.paints() == EXPECTED and inv.paints() == EXPECTED
    assert len(runner.calls) == 1
    command, options = runner.calls[0]
    assert command == ["mpaint", "inventory", "list", "--json"]
    assert options["timeout"] == 30 and not options.get("shell")
    status = inv.refresh()
    assert len(runner.calls) == 2
    assert status["state"] == "ok" and status["count"] == 2 and status["error"] is None and status["loaded"]


def test_every_kind_of_failure_leaves_an_empty_list_and_says_why():
    failures = [
        FileNotFoundError("node"),
        SimpleNamespace(returncode=1, stdout="", stderr="boom"),
        SimpleNamespace(returncode=0, stdout="not json", stderr=""),
        SimpleNamespace(returncode=0, stdout='"a string"', stderr=""),
        SimpleNamespace(returncode=0, stdout='{"error": "unknown command"}', stderr=""),
        SimpleNamespace(returncode=0, stdout='[{"id": "c/x", "name": "X", "owned": true}]', stderr=""),
        subprocess.TimeoutExpired("mpaint", 30),
    ]
    for failure in failures:
        inv = Inventory(["mpaint"], Runner(failure))
        assert inv.paints() == []
        status = inv.status()
        assert status["state"] == "error" and status["error"] and status["count"] == 0


def test_a_later_refresh_recovers():
    inv = Inventory(["mpaint"], Runner(FileNotFoundError("node"), ok()))
    assert inv.paints() == []
    assert inv.refresh()["state"] == "ok" and inv.paints() == EXPECTED


def test_fixed_never_runs_anything():
    inv = Inventory.fixed(EXPECTED)
    assert inv.paints() == EXPECTED and inv.status()["state"] == "ok" and inv.status()["count"] == 2
    assert inv.refresh()["state"] == "ok" and inv.paints() == EXPECTED


def test_the_command_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("WPM_MPAINT", "mpaint inventory list --json")
    assert inventory.default_command() == ["mpaint", "inventory", "list", "--json"]
    monkeypatch.delenv("WPM_MPAINT")
    command = inventory.default_command()
    assert command[0] == "node" and command[1].endswith("warpaint-cli/src/cli.mjs") and "~" not in command[1]
    # The whole catalogue with what is owned marked in it: one run serves the steps and the shopping list.
    assert command[2:] == ["paint", "search", "--json"]


def test_the_rest_of_the_catalogue_is_kept_for_proposals():
    inv = Inventory(["mpaint"], Runner(ok()))
    assert inv.others() == [{"id": "c/not-owned", "name": "Not Owned", "provider": "citadel", "format": "opaque_base",
                             "hex": "#010203"}]
    assert inv.paints() == EXPECTED and inv.status()["catalogue"] == 3
    failed = Inventory(["mpaint"], Runner(FileNotFoundError("node")))
    assert failed.others() == [] and failed.status()["catalogue"] == 0
    fixed = Inventory.fixed(EXPECTED, others=inv.others())
    assert fixed.others() == inv.others() and fixed.status()["catalogue"] == 3
    assert Inventory.fixed(EXPECTED).others() == []
