#!/usr/bin/env python3
"""Start the figure painting planner, or hand a directory to the one already running.

    uv run server.py [model-dir] [--port 8770] [--no-browser]
"""
import argparse
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser

import uvicorn

from wpm.app import APP_NAME, create_app
from wpm.inventory import Inventory

HOST = "127.0.0.1"
DEFAULT_PORT = 8770


def _request(url: str, payload: dict | None = None, timeout: float = 5) -> tuple[int, dict]:
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read() or b"{}")
        except ValueError:
            return error.code, {}


def _is_ours(base: str) -> bool:
    try:
        status, body = _request(f"{base}/api/health", timeout=1)
    except (OSError, ValueError):
        return False
    return status == 200 and body.get("app") == APP_NAME


def _port_taken(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(1)
        return probe.connect_ex((HOST, port)) == 0


def _open(base: str, path: str | None, browser: bool) -> int:
    """Hand the path to the server at `base` and show the result. Returns a process exit code."""
    target = f"{base}/"
    if path:
        status, body = _request(f"{base}/api/projects", {"path": path}, timeout=60)
        if status != 200:
            print(body.get("error", f"The server refused the directory (HTTP {status})."), file=sys.stderr)
            return 1
        target = f"{base}/#p/{body['slug']}"
    print(target)
    if browser:
        webbrowser.open(target)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("path", nargs="?", help="directory of the model package to open")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    args = parser.parse_args(argv)
    if args.path:                            # the server may run elsewhere (launchd): send an absolute path
        args.path = os.path.abspath(os.path.expanduser(args.path))
    base = f"http://{HOST}:{args.port}"

    if _is_ours(base):                       # already running (launchd, another terminal): reuse it
        return _open(base, args.path, not args.no_browser)
    if _port_taken(args.port):
        print(f"Port {args.port} is in use by another program.", file=sys.stderr)
        return 1

    server = uvicorn.Server(uvicorn.Config(create_app(inventory=Inventory()), host=HOST, port=args.port,
                                           log_level="warning", timeout_graceful_shutdown=2))
    exit_code = [0]

    def after_start() -> None:
        while not server.started:
            if server.should_exit:
                return
            time.sleep(0.05)
        exit_code[0] = _open(base, args.path, not args.no_browser)
        if exit_code[0]:
            server.should_exit = True        # a rejected directory leaves no server behind

    threading.Thread(target=after_start, daemon=True).start()
    server.run()
    return exit_code[0]


if __name__ == "__main__":
    sys.exit(main())
