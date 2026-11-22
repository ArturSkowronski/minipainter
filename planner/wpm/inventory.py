"""The paints Artur owns, read from the minipainter CLI.

The command runs once per server and again only when asked, so moving a slider never starts a process.
A failure is not an error of this app: the list is then empty and `status()` says why.
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
    return ["node", str(cli), "inventory", "list", "--json"]


def parse(text: str) -> list[dict]:
    """Owned paints with a product format and a colour, sorted by name. ValueError if `text` is not the list."""
    data = json.loads(text)
    items = data.get("items", []) if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise ValueError("the inventory is not a list of paints")
    paints = []
    for item in items:
        if not isinstance(item, dict) or not item.get("owned") or not item.get("product_format"):
            continue
        rgb = item.get("rgb")
        try:
            colour = rgb_to_hex(*(min(255, max(0, int(rgb[k]))) for k in "rgb"))
            paints.append({"id": str(item["id"]), "name": str(item["name"]),
                           "provider": str(item.get("provider") or ""),
                           "format": str(item["product_format"]), "hex": colour})
        except (KeyError, TypeError, ValueError):
            continue
    return sorted(paints, key=lambda p: (p["name"].lower(), p["id"]))


class Inventory:
    def __init__(self, command: list[str] | None = None, runner=subprocess.run):
        self._command = command
        self._runner = runner
        self._lock = threading.Lock()
        self._paints: list[dict] = []
        self._state = "unread"
        self._error: str | None = None
        self._loaded: str | None = None

    @classmethod
    def fixed(cls, paints: list[dict]) -> "Inventory":
        """A list that is given, not read: for tests and for running without minipainter."""
        inventory = cls(command=[])
        inventory._paints = [dict(p) for p in paints]
        inventory._state = "ok"
        return inventory

    def paints(self) -> list[dict]:
        with self._lock:
            if self._state == "unread":
                self._load()
            return [dict(p) for p in self._paints]

    def refresh(self) -> dict:
        with self._lock:
            if self._command != []:
                self._load()
            return self._status()

    def status(self) -> dict:
        with self._lock:
            return self._status()

    def _status(self) -> dict:
        return {"state": self._state, "count": len(self._paints), "loaded": self._loaded, "error": self._error}

    def _load(self) -> None:
        command = self._command if self._command is not None else default_command()
        try:
            done = self._runner(command, capture_output=True, text=True, timeout=TIMEOUT_SECONDS)
            if done.returncode != 0:
                raise RuntimeError((done.stderr or "").strip()[:300] or f"exit code {done.returncode}")
            self._paints = parse(done.stdout)
            self._state, self._error = "ok", None
        except subprocess.TimeoutExpired:
            self._fail(f"no answer within {TIMEOUT_SECONDS} s")
        except (OSError, RuntimeError, ValueError, AttributeError) as error:
            self._fail(f"{type(error).__name__}: {error}")
        self._loaded = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    def _fail(self, reason: str) -> None:
        self._paints, self._state, self._error = [], "error", reason
