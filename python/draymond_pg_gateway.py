"""Draymond Postgres/TimescaleDB gateway.

Wires the book-scan Postgres artifacts (Magda Ch3/Ch5/Ch9/Ch11) into the live
Draymond orchestrator. The orchestrator (Next.js/TS) already talks to Python
services over HTTP (see src/lib/bookbridge.ts -> 127.0.0.1:8777); this gateway
follows the same contract so the TS runtime can adopt it.

It exposes three capabilities, each backed by the validated modules:
  * /queue/*      -> draymond_queue  (Magda Ch11: Postgres-as-queue)
  * /dag/*        -> DAG             (Magda Ch3 §3.4: recursive-CTE DAG)
  * /ts/*         -> timeseries      (Magda Ch9: TimescaleDB hypertables + CAs)

Backends:
  * If DATABASE_URL is set, the psycopg2-backed classes run against a real
    Postgres/TimescaleDB (deploy path).
  * Otherwise an in-memory fallback runs (no driver needed) so the service and
    its contract are testable offline. The orchestrator falls back to its
    existing SQLite/in-memory path until DATABASE_URL is configured.

Run: python draymond_pg_gateway.py [--port 8787]
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import draymond_queue as mq  # noqa: E402
import DAG as dag_mod  # noqa: E402
import timeseries as ts_mod  # noqa: E402


def make_backend():
    url = os.environ.get("DATABASE_URL")
    if url:
        import psycopg2  # lazy; only on the deploy path
        conn = psycopg2.connect(url)
        return {
            "queue": mq.PgCustomQueue(conn),
            "dag": dag_mod.PgDag(conn),
            "ts": ts_mod.PgTimeSeries(conn),
        }
    return {
        "queue": mq.InMemoryMessageQueue(),
        "dag": dag_mod.InMemoryDag(),
        "ts": ts_mod.InMemoryTimeSeries(),
    }


_BACKEND = make_backend()


def _ok(payload, status=200):
    return status, payload


def _err(msg, status=400):
    return status, {"error": msg}


def dispatch(method: str, path: str, query: dict, body: dict) -> tuple:
    """Route an HTTP request to a backend. Returns (status, json_payload).

    Pure and socket-free so it can be unit-tested directly (see
    test_draymond_pg_gateway.py)."""
    parts = [p for p in path.split("/") if p]
    if not parts:
        return _err("not found", 404)
    # Normalize query: parse_qs yields lists; tests may pass plain strings.
    query = {k: (v[0] if isinstance(v, list) and v else (v if not isinstance(v, list) else ""))
             for k, v in query.items()}
    svc, *rest = parts

    # ---- health -----------------------------------------------------------
    if svc == "health":
        return _ok({"status": "ok", "backend": "postgres" if os.environ.get("DATABASE_URL") else "memory"})

    # ---- queue (Magda Ch11) ----------------------------------------------
    if svc == "queue":
        if rest == ["enqueue"] and method == "POST":
            msg = body.get("message")
            if msg is None:
                return _err("message required")
            mid = _BACKEND["queue"].enqueue(msg, notify=body.get("notify", True))
            return _ok({"msg_id": mid})
        if rest == ["dequeue"] and method == "POST":
            size = int(body.get("batch_size", 1))
            items = _BACKEND["queue"].dequeue(batch_size=size)
            return _ok({"items": items})
        if rest == ["complete"] and method == "POST":
            ids = body.get("ids") or []
            _BACKEND["queue"].mark_completed(ids, delete=body.get("delete", False))
            return _ok({"marked": len(ids)})
        return _err("unknown queue route", 404)

    # ---- dag (Magda Ch3 §3.4) --------------------------------------------
    if svc == "dag":
        if rest == ["edge"] and method == "POST":
            cid = body.get("chain_id")
            dep = body.get("depends_on")
            if not cid or not dep:
                return _err("chain_id and depends_on required")
            try:
                _BACKEND["dag"].add_edge(cid, dep)
            except ValueError as e:
                return _err(str(e), 409)
            return _ok({"added": [cid, dep]})
        if rest == ["ancestors"] and method == "GET":
            cid = query.get("chain", "")
            return _ok({"chain": cid, "ancestors": _BACKEND["dag"].ancestors(cid)})
        if rest == ["descendants"] and method == "GET":
            cid = query.get("chain", "")
            return _ok({"chain": cid, "descendants": _BACKEND["dag"].descendants(cid)})
        if rest == ["levels"] and method == "GET":
            return _ok({"levels": _BACKEND["dag"].topological_levels()})
        return _err("unknown dag route", 404)

    # ---- timeseries (Magda Ch9) ------------------------------------------
    if svc == "ts":
        if rest == ["sample"] and method == "POST":
            aid = body.get("agent_id")
            ts = body.get("recorded_at")
            val = body.get("value")
            if not aid or ts is None or val is None:
                return _err("agent_id, recorded_at, value required")
            _BACKEND["ts"].add_sample(aid, _parse_dt(ts), float(val))
            return _ok({"stored": True})
        if rest == ["aggregate"] and method == "POST":
            _BACKEND["ts"].create_continuous_aggregate(
                bucket=body.get("bucket", "5 minutes"),
                low_threshold=float(body.get("low_threshold", 50.0)))
            return _ok({"created": True})
        if rest == ["refresh"] and method == "POST":
            _BACKEND["ts"].refresh(_parse_dt(body["start"]), _parse_dt(body["end"]))
            return _ok({"refreshed": True})
        if rest == ["window"] and method == "GET":
            start = _parse_dt(query.get("start", ""))
            end = _parse_dt(query.get("end", ""))
            aid = query.get("agent", "")
            ft = int(query.get("flag_threshold", "5"))
            rows = _BACKEND["ts"].query_window(start, end, aid, flag_threshold=ft)
            return _ok({"rows": rows})
        return _err("unknown ts route", 404)

    return _err("not found", 404)


def _parse_dt(s: str):
    from datetime import datetime, timezone
    s = s.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


class _Handler(BaseHTTPRequestHandler):
    def _respond(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        query = {k: v for k, v in parse_qs(parsed.query).items()}
        status, payload = dispatch("GET", parsed.path, query, {})
        self._respond(status, payload)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            body = {}
        parsed = urlparse(self.path)
        status, payload = dispatch("POST", parsed.path, {}, body)
        self._respond(status, payload)

    def log_message(self, *args):  # silence default logging
        pass


def main():
    port = 8787
    if "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])
    print(f"Draymond PG gateway on :{port} "
          f"({'postgres' if os.environ.get('DATABASE_URL') else 'in-memory'})")
    httpd = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
