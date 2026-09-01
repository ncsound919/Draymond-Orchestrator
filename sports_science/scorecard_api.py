"""Minimal HTTP surface for the sports validation scorecard.

GET /api/v1/science/scorecard -> {scorecard: {...}, persist: {...}}
Pure stdlib http.server. No auth (internal science surface); keep it read-only.
Writes to data/draymond.db science_insights table via persist_scorecard().
"""
from __future__ import annotations

import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import sqlite3

from sports_science.validation_scorecard import build_sports_scorecard
from sports_science.evidence import worst_tier
from sports_science.validation_engine import utc_now_iso


DB_PATH = Path(__file__).resolve().parent.parent / "data" / "draymond.db"


def _compute_id(source: str, session_id: str, generated_at: str) -> str:
    h = hashlib.sha256()
    h.update(f"{source}:{session_id}:{generated_at}".encode())
    return "si_" + h.hexdigest()[:24]


def persist_scorecard(scorecard: dict, source: str = "sports_scorecard",
                     session_id: str = "") -> dict:
    """Persist the scorecard into data/draymond.db science_insights table.
    
    Returns {ok: True, id: <id>} on success or {ok: False, error: <message>} on failure.
    Idempotent: re-persisting with the same source+session_id+generated_at updates the row.
    """
    db_path = DB_PATH
    if not db_path.exists():
        return {"ok": False, "error": f"database not found: {db_path}"}
    
    try:
        generated_at = scorecard.get("summary", {}).get("generated_at", utc_now_iso())
        evidence_tier = worst_tier(scorecard) or "E3"
        report_json = json.dumps(scorecard, default=str)
        id_ = _compute_id(source, session_id, generated_at)
        now = utc_now_iso()
        
        conn = sqlite3.connect(str(db_path))
        try:
            conn.execute(
                """INSERT INTO science_insights 
                   (id, source, session_id, domain, report, evidence_tier, generated_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(source, session_id, generated_at)
                   DO UPDATE SET report=excluded.report, evidence_tier=excluded.evidence_tier,
                                  updated_at=excluded.updated_at""",
                (id_, source, session_id, "sports", report_json, evidence_tier, generated_at, now, now),
            )
            conn.commit()
            return {"ok": True, "id": id_}
        except sqlite3.Error as exc:
            return {"ok": False, "error": str(exc)}
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


def build_scorecard_handler_response() -> tuple[int, list[tuple[str, str]], str]:
    scorecard = build_sports_scorecard()
    persist_result = persist_scorecard(scorecard)
    body = json.dumps({"scorecard": scorecard, "persist": persist_result}, default=str)
    return (
        200,
        [("Content-Type", "application/json"), ("Content-Length", str(len(body)))],
        body,
    )


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if urlparse(self.path).path == "/api/v1/science/scorecard":
            status, headers, body = build_scorecard_handler_response()
        else:
            status, headers, body = 404, [("Content-Type", "application/json")], json.dumps({"error": "not found"})
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def log_message(self, *args):
        pass


def serve(host: str = "127.0.0.1", port: int = 8201) -> None:
    server = ThreadingHTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
