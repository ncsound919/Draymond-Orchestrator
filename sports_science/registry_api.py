# sports_science/registry_api.py
"""Minimal read-only HTTP surface for the sports trust chain.

  GET /api/v1/science/registry -> {ok, count, engines, lockfile, generated_at}
  GET /api/v1/science/drift    -> {ok, status, drifted}
  GET /api/v1/science/health   -> {ok, engines, lockfile, drift}

Pure stdlib ``http.server``. No auth (internal science surface); read-only.
Mirrors ``scorecard_api.py``. The deployment proxies these so any number it
shows can be traced to a lockfile-pinned engine (see DEPRECATED.md policy).
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

# Allow running as a script from the repo root (mirrors run_drift.py).
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sports_science.engine_registry import LOCKFILE_PATH, snapshot_all_engines  # noqa: E402
from sports_science.run_drift import drift_lines  # noqa: E402
from sports_science.validation_engine import utc_now_iso  # noqa: E402

_JSON = "application/json"


def _json_response(payload: dict, status: int = 200) -> tuple[int, list[tuple[str, str]], str]:
    body = json.dumps(payload, default=str)
    return (
        status,
        [("Content-Type", _JSON), ("Content-Length", str(len(body)))],
        body,
    )


def _lockfile_sha256() -> str | None:
    try:
        return hashlib.sha256(LOCKFILE_PATH.read_bytes()).hexdigest()
    except OSError:
        return None


def _drift_payload() -> dict:
    try:
        expected = json.loads(LOCKFILE_PATH.read_text(encoding="utf-8"))
    except OSError:
        return {"ok": False, "status": "missing", "drifted": []}
    lines = drift_lines(snapshot_all_engines(), expected)
    return {"ok": not lines, "status": "ok" if not lines else "drift", "drifted": lines}


def build_registry_response() -> tuple[int, list[tuple[str, str]], str]:
    """Engine inventory: name, semver, inputsHash — plus the lockfile address."""
    snap = snapshot_all_engines()
    engines = [
        {"engine": e["engine"], "version": e["version"], "inputsHash": e["inputsHash"]}
        for e in snap
    ]
    return _json_response({
        "ok": True,
        "count": len(engines),
        "engines": engines,
        "lockfile": {"path": str(LOCKFILE_PATH), "sha256": _lockfile_sha256()},
        "generated_at": utc_now_iso(),
    })


def build_drift_response() -> tuple[int, list[tuple[str, str]], str]:
    """Whether any registered engine's output diverges from the golden lockfile."""
    return _json_response(_drift_payload())


def build_health_response() -> tuple[int, list[tuple[str, str]], str]:
    """Trust-chain health: engine count, lockfile address, drift status."""
    drift = _drift_payload()
    return _json_response({
        "ok": bool(drift.get("ok")),
        "engines": len(snapshot_all_engines()),
        "lockfile": {"sha256": _lockfile_sha256()},
        "drift": drift,
        "generated_at": utc_now_iso(),
    })


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/v1/science/registry":
            status, headers, body = build_registry_response()
        elif path == "/api/v1/science/drift":
            status, headers, body = build_drift_response()
        elif path == "/api/v1/science/health":
            status, headers, body = build_health_response()
        else:
            status, headers, body = _json_response({"error": "not found"}, status=404)
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def log_message(self, *args):  # keep output quiet
        pass


def serve(host: str = "127.0.0.1", port: int = 8202) -> None:
    server = ThreadingHTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    serve(
        host=os.environ.get("SCIENCE_API_HOST", "127.0.0.1"),
        port=int(os.environ.get("SCIENCE_API_PORT", "8202")),
    )
