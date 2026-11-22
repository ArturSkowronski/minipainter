"""The paints Artur owns, and the rest of minipainter's catalogue, read from the minipainter CLI.

The command runs once per server and again only when asked, so moving a slider never starts a process.
A failure is not an error of this app: the lists are then empty and `status()` says why.
"""
import datetime as dt
import json
import os
import shlex
import subprocess
import threading
from pathlib import Path

from wpm.colour import rgb_to_hex

TIMEOUT_SECONDS = 30


def default_command() -> list[str]:
    """`WPM_MPAINT` (a command line), else the minipainter checkout next to this project."""
    override = os.environ.get("WPM_MPAINT")
    if override:
        return shlex.split(override)
    cli = Path.home() / "Priv" / "warpaint-cli" / "src" / "cli.mjs"
    # A search for nothing lists the whole catalogue, each paint marked owned or not. A command that
    # lists only the owned paints (`inventory list --json`) works too; then there is nothing to propose.
    return ["node", str(cli), "paint", "search", "--json"]


def parse(text: str) -> list[dict]:
    """Owned paints with a product format and a colour, sorted by name."""
    return read(text)[0]


def read(text: str) -> tuple[list[dict], list[dict]]:
    """(owned paints, the other paints of the list), each with a product format and a colour, sorted by name.

    ValueError when `text` is not minipainter's list: something else that happens to be JSON (an error
    object, the output of a version without `product_format`) must not pass for "owns no paints".
    """
    data = json.loads(text)
    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise ValueError("the inventory is not a list of paints")
    paints, others = [], []
    for item in items:
        if not isinstance(item, dict) or not item.get("product_format"):
            continue
        rgb = item.get("rgb")
        try:
            paint = {"id": str(item["id"]), "name": str(item["name"]), "provider": str(item.get("provider") or ""),
                     "format": str(item["product_format"]),
                     "hex": rgb_to_hex(*(min(255, max(0, int(rgb[k]))) for k in "rgb"))}
        except (KeyError, TypeError, ValueError):
            continue
        (paints if item.get("owned") else others).append(paint)
    if items and not paints and not others:
        raise ValueError("no entry of the inventory has a product_format and an rgb colour")
    return sorted(paints, key=_by_name), sorted(others, key=_by_name)


def _by_name(paint: dict) -> tuple[str, str]:
    return paint["name"].lower(), paint["id"]


class Inventory:
    def __init__(self, command: list[str] | None = None, runner=subprocess.run):
        self._command = command
        self._runner = runner
        self._lock = threading.Lock()
        self._paints: list[dict] = []
        self._others: list[dict] = []
        self._state = "unread"
        self._error: str | None = None
        self._loaded: str | None = None

    @classmethod
    def fixed(cls, paints: list[dict], others: list[dict] = ()) -> "Inventory":
        """Lists that are given, not read: for tests and for running without minipainter."""
        inventory = cls(command=[])
        inventory._paints = [dict(p) for p in paints]
        inventory._others = [dict(p) for p in others]
        inventory._state = "ok"
        return inventory

    def paints(self) -> list[dict]:
        with self._lock:
            if self._state == "unread":
                self._load()
            return [dict(p) for p in self._paints]

    def others(self) -> list[dict]:
        """The paints of the catalogue that are not owned: what a shopping list can propose."""
        with self._lock:
            if self._state == "unread":
                self._load()
            return [dict(p) for p in self._others]

    def refresh(self) -> dict:
        with self._lock:
            if self._command != []:
                self._load()
            return self._status()

    def status(self) -> dict:
        with self._lock:
            return self._status()

    def _status(self) -> dict:
        return {"state": self._state, "count": len(self._paints), "catalogue": len(self._paints) + len(self._others),
                "loaded": self._loaded, "error": self._error}

    def _load(self) -> None:
        command = self._command if self._command is not None else default_command()
        try:
            done = self._runner(command, capture_output=True, text=True, timeout=TIMEOUT_SECONDS)
            if done.returncode != 0:
                raise RuntimeError((done.stderr or "").strip()[:300] or f"exit code {done.returncode}")
            self._paints, self._others = read(done.stdout)
            self._state, self._error = "ok", None
        except subprocess.TimeoutExpired:
            self._fail(f"no answer within {TIMEOUT_SECONDS} s")
        except (OSError, RuntimeError, ValueError, AttributeError) as error:
            self._fail(f"{type(error).__name__}: {error}")
        self._loaded = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    def _fail(self, reason: str) -> None:
        self._paints, self._others, self._state, self._error = [], [], "error", reason
