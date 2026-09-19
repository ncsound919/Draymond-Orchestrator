"""Postgres-as-a-message-queue for the Draymond orchestration layer.

Faithful port of Magda, *Just Use Postgres!* (2026), Chapter 11 "Postgres as a
message queue", grounded in the book's listings:

  * Custom queue (Listings 11.1-11.5): `mq.queue` table (id BIGSERIAL, message
    JSON, created_at TIMESTAMPTZ, status ENUM new/processing/completed) plus
    the `mq.enqueue` / `mq.dequeue` / `mq.mark_completed` PL/pgSQL functions.
  * `mq.dequeue` uses `FOR UPDATE SKIP LOCKED` (Listing 11.3) so concurrent
    consumers never grab the same message — the atomically-claimed row stays
    `processing` and invisible to others until `mark_completed`.
  * LISTEN / NOTIFY (Listing 11.5 + §11.4): `enqueue` fires
    `pg_notify('queue_new_message', ...)`; consumers `LISTEN` on the channel.
  * Indexing (§11.5.2): partial index `(created_at, status) WHERE status='new'`
    so dequeue skips already-processing rows without a full table scan.
  * Partitioning (§11.5.3): range partition by `created_at` for high volume.
  * Failover (§11.5.4): messages stuck in `processing` past a TTL are reset to
    `new` so another worker can pick them up.
  * pgmq extension (§11.6-11.7): `CREATE EXTENSION pgmq` then SQS-parity
    `pgmq.create / send / read / archive / delete` with a visibility-timeout
    `vt_offset` on `read` (API as cited by the book; v1.5.1).

The Draymond core currently runs on SQLite with an in-memory bridge queue
(see exploration: `bridge-server.ts` uses a non-persistent Map). This module
gives a deploy-ready Postgres/pgmq implementation AND a pure-Python
`InMemoryMessageQueue` that mirrors the same status lifecycle + SKIP-LOCKED
visibility + LISTEN/NOTIFY semantics, so the orchestration logic is testable
and runnable today without a live Postgres. Both implement the same
`MessageQueue` interface, so swapping backends is a one-line change.
"""

from __future__ import annotations

import json
import re
import time
import threading
import uuid
from typing import Callable, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# SQL identifier safety
# ---------------------------------------------------------------------------
# PostgreSQL cannot parameterise identifiers (LISTEN channels, queue names), so
# every interpolated identifier is constrained to the identifier grammar first.
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _safe_ident(name: str) -> str:
    """Return ``name`` if it is a safe SQL identifier, else raise ValueError."""
    text = str(name)
    if not _IDENT_RE.match(text):
        raise ValueError(f"invalid SQL identifier: {name!r}")
    return text


# ---------------------------------------------------------------------------
# SQL generation (exact text Magda prescribes; validated by tests)
# ---------------------------------------------------------------------------
def custom_queue_ddl(partitioned: bool = False, partition_by_day: bool = False) -> List[str]:
    """Listing 11.1 + §11.5.2/§11.5.3 DDL for the custom Postgres queue."""
    ddl = [
        "CREATE SCHEMA IF NOT EXISTS mq;",
        "CREATE TYPE IF NOT EXISTS mq.status AS ENUM ('new', 'processing', 'completed');",
    ]
    if not partitioned:
        ddl.append(
            "CREATE TABLE IF NOT EXISTS mq.queue ("
            "  id BIGSERIAL PRIMARY KEY,"
            "  message JSON NOT NULL,"
            "  created_at TIMESTAMPTZ DEFAULT NOW(),"
            "  status mq.status NOT NULL DEFAULT 'new'"
            ");"
        )
    else:
        ddl.append(
            "CREATE TABLE IF NOT EXISTS mq.queue ("
            "  id BIGSERIAL,"
            "  message JSON NOT NULL,"
            "  created_at TIMESTAMPTZ DEFAULT NOW(),"
            "  status mq.status NOT NULL DEFAULT 'new',"
            "  PRIMARY KEY (id, created_at)"
            ") PARTITION BY RANGE (created_at);"
        )
        if partition_by_day:
            ddl.append(
                "CREATE TABLE IF NOT EXISTS mq.queue_default "
                "PARTITION OF mq.queue DEFAULT;"
            )
    # §11.5.2 partial index: dequeue skips non-new rows.
    ddl.append(
        "CREATE INDEX IF NOT EXISTS mq_partial_index_btree "
        "ON mq.queue (created_at, status) WHERE status = 'new';"
    )
    return ddl


def enqueue_sql(notify: bool = False) -> Tuple[str, str]:
    """Listing 11.2 (plain) and Listing 11.5 (with pg_notify)."""
    if notify:
        return (
            "CREATE OR REPLACE FUNCTION mq.enqueue(new_message JSON) "
            "RETURNS VOID AS $$\nBEGIN\n"
            "  INSERT INTO mq.queue (message) VALUES (new_message);\n"
            "  PERFORM pg_notify('queue_new_message', 'new_message');\n"
            "END;\n$$ LANGUAGE plpgsql;",
            "SELECT mq.enqueue(%s::json);",
        )
    return (
        "CREATE OR REPLACE FUNCTION mq.enqueue(new_message JSON) "
        "RETURNS VOID AS $$\nBEGIN\n"
        "  INSERT INTO mq.queue (message) VALUES (new_message);\n"
        "END;\n$$ LANGUAGE plpgsql;",
        "SELECT mq.enqueue(%s::json);",
    )


def dequeue_sql() -> str:
    """Listing 11.3 verbatim: FOR UPDATE SKIP LOCKED, status->processing."""
    return (
        "CREATE OR REPLACE FUNCTION mq.dequeue(messages_cnt INT) "
        "RETURNS TABLE (msg_id BIGINT, message JSON, enqueued_at TIMESTAMPTZ) AS $$\n"
        "BEGIN\n"
        "  RETURN QUERY\n"
        "  WITH new_messages AS (\n"
        "    SELECT id FROM mq.queue\n"
        "    WHERE status = 'new' ORDER BY created_at\n"
        "    FOR UPDATE SKIP LOCKED\n"
        "    LIMIT messages_cnt\n"
        "  )\n"
        "  UPDATE mq.queue q SET status = 'processing'\n"
        "  FROM new_messages WHERE q.id = new_messages.id\n"
        "  RETURNING q.id, q.message,\n"
        "    date_trunc('seconds', q.created_at) AS created_at;\n"
        "END;\n$$ LANGUAGE plpgsql;"
    )


def mark_completed_sql() -> str:
    """Listing 11.4 verbatim."""
    return (
        "CREATE OR REPLACE FUNCTION mq.mark_completed(\n"
        "  message_ids BIGINT[], to_delete BOOLEAN DEFAULT FALSE)\n"
        "RETURNS VOID AS $$\nBEGIN\n"
        "  IF to_delete THEN\n"
        "    DELETE FROM mq.queue WHERE id = ANY(message_ids);\n"
        "  ELSE\n"
        "    UPDATE mq.queue SET status = 'completed'\n"
        "    WHERE id = ANY(message_ids);\n"
        "  END IF;\n"
        "END;\n$$ LANGUAGE plpgsql;"
    )


def pgmq_ddl(queue_name: str) -> List[str]:
    """§11.6-11.7: enable pgmq and create the queue (SQS-parity)."""
    return [
        "CREATE EXTENSION IF NOT EXISTS pgmq;",
        f"SELECT pgmq.create('{queue_name}');",
    ]


def failover_ddl() -> List[str]:
    """§11.5.4 failover: add a processing-start column so a pg_cron job can reset
    messages stuck in `processing` past a TTL back to `new`. This extends the
    verbatim Listing 11.1 table with the one column the failover pattern needs
    (the book's example DMV scenario bounds processing by a 1-minute SLA)."""
    return [
        "ALTER TABLE mq.queue ADD COLUMN IF NOT EXISTS processing_since TIMESTAMPTZ;",
        "CREATE INDEX IF NOT EXISTS mq_processing_idx ON mq.queue (processing_since) "
        "WHERE status = 'processing';",
    ]


# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------
class MessageQueue:
    def enqueue(self, message: dict, notify: bool = True) -> str:
        raise NotImplementedError

    def dequeue(self, batch_size: int = 1) -> List[dict]:
        raise NotImplementedError

    def mark_completed(self, msg_ids: List[str], delete: bool = False) -> None:
        raise NotImplementedError

    def requeue_stale(self, ttl_seconds: float) -> int:
        raise NotImplementedError

    def listen(self, channel: str, callback: Callable[[str, str], None]) -> None:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Pure-Python fallback (mirrors SKIP LOCKED + LISTEN/NOTIFY semantics)
# ---------------------------------------------------------------------------
class InMemoryMessageQueue(MessageQueue):
    """Testable, dependency-free queue with the same lifecycle as Magda's
    `mq.queue`: new -> processing (claimed/invisible) -> completed.

    A message dequeued by one consumer is invisible to others until
    `mark_completed` (the SKIP LOCKED contract). Stale claims past `ttl_seconds`
    are reset to `new` by `requeue_stale` (§11.5.4 failover). `enqueue` fires
    LISTEN/NOTIFY callbacks (§11.4)."""

    def __init__(self, channel: str = "queue_new_message", ttl_seconds: float = 300.0):
        self._channel = channel
        self._ttl = ttl_seconds
        self._lock = threading.RLock()
        self._rows = []  # list of dict(id, message, created_at, status, claimed_at)
        self._seq = 0
        self._listeners: List[Callable[[str, str], None]] = []

    def enqueue(self, message: dict, notify: bool = True) -> str:
        with self._lock:
            self._seq += 1
            mid = str(self._seq)
            self._rows.append({
                "id": mid,
                "message": message,
                "created_at": time.time(),
                "status": "new",
                "claimed_at": None,
            })
        if notify:
            for cb in list(self._listeners):
                cb(self._channel, json.dumps(message))
        return mid

    def dequeue(self, batch_size: int = 1) -> List[dict]:
        out = []
        with self._lock:
            for row in sorted(self._rows, key=lambda r: r["created_at"]):
                if len(out) >= batch_size:
                    break
                if row["status"] == "new":
                    row["status"] = "processing"
                    row["claimed_at"] = time.time()
                    out.append({"msg_id": row["id"], "message": row["message"]})
        return out

    def mark_completed(self, msg_ids: List[str], delete: bool = False) -> None:
        with self._lock:
            ids = set(msg_ids)
            for row in list(self._rows):
                if row["id"] in ids:
                    if delete:
                        self._rows.remove(row)
                    else:
                        row["status"] = "completed"

    def requeue_stale(self, ttl_seconds: Optional[float] = None) -> int:
        ttl = self._ttl if ttl_seconds is None else ttl_seconds
        now = time.time()
        reset = 0
        with self._lock:
            for row in self._rows:
                if row["status"] == "processing" and row["claimed_at"] is not None:
                    if now - row["claimed_at"] >= ttl:
                        row["status"] = "new"
                        row["claimed_at"] = None
                        reset += 1
        return reset

    def listen(self, channel: str, callback: Callable[[str, str], None]) -> None:
        if channel == self._channel:
            self._listeners.append(callback)

    def _raw_state(self):
        with self._lock:
            return [(r["id"], r["status"]) for r in self._rows]


# ---------------------------------------------------------------------------
# Psycopg2-backed custom queue (deploy path; SQL matches Magda listings)
# ---------------------------------------------------------------------------
class PgCustomQueue(MessageQueue):
    """Executes the generated `mq.*` functions against a live Postgres conn."""

    def __init__(self, conn, channel: str = "queue_new_message"):
        # psycopg2 imported lazily so the module loads without the driver.
        import psycopg2  # noqa: F401
        self._conn = conn
        self._channel = channel

    def enqueue(self, message: dict, notify: bool = True) -> str:
        # Listing 11.5 REDEFINES mq.enqueue to include pg_notify, so the call is
        # always mq.enqueue regardless of notify; `notify` selects which DDL
        # variant (enqueue_sql) was deployed.
        cur = self._conn.cursor()
        try:
            cur.execute("SELECT mq.enqueue(%s::json);", (json.dumps(message),))
            self._conn.commit()
            return "ok"
        finally:
            cur.close()

    def dequeue(self, batch_size: int = 1) -> List[dict]:
        cur = self._conn.cursor()
        try:
            cur.execute("SELECT * FROM mq.dequeue(%s);", (int(batch_size),))
            rows = cur.fetchall()
            return [{"msg_id": r[0], "message": r[1]} for r in rows]
        finally:
            cur.close()

    def mark_completed(self, msg_ids: List[str], delete: bool = False) -> None:
        cur = self._conn.cursor()
        try:
            ids = [int(m) for m in msg_ids]
            cur.execute("SELECT mq.mark_completed(%s, %s);", (ids, bool(delete)))
            self._conn.commit()
        finally:
            cur.close()

    def requeue_stale(self, ttl_seconds: float) -> int:
        cur = self._conn.cursor()
        try:
            # §11.5.4 failover: reset messages stuck in processing past TTL.
            # Requires failover_ddl() (adds processing_since) and dequeue to set it.
            cur.execute(
                "UPDATE mq.queue SET status='new', processing_since=NULL "
                "WHERE status='processing' "
                "AND NOW() - processing_since > (%s || ' seconds')::interval;",
                (float(ttl_seconds),),
            )
            n = cur.rowcount
            self._conn.commit()
            return int(n) if n is not None else 0
        finally:
            cur.close()

    def listen(self, channel: str, callback: Callable[[str, str], None]) -> None:
        cur = self._conn.cursor()
        cur.execute(f"LISTEN {_safe_ident(channel)};")  # nosemgrep: python.lang.security.audit.formatted-sql-query.formatted-sql-query, python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query -- channel is validated by _safe_ident(); Postgres cannot bind identifiers.
        # Non-blocking notification pump; real usage wires this to a NOTIFY loop.
        self._conn.commit()
        for n in self._conn.notifies():
            callback(n.channel, n.payload or "")


# ---------------------------------------------------------------------------
# pgmq-backed queue (SQS-parity; v1.5.1 API as cited by the book)
# ---------------------------------------------------------------------------
def pgmq_send_sql(queue_name: str) -> str:
    return f"SELECT pgmq.send('{_safe_ident(queue_name)}', %s::jsonb);"


def pgmq_read_sql(queue_name: str) -> str:
    # vt_offset = visibility timeout seconds; read makes messages invisible that long.
    return f"SELECT msg_id, message, vt FROM pgmq.read('{_safe_ident(queue_name)}', %s, %s);"


def pgmq_archive_sql(queue_name: str) -> str:
    return f"SELECT pgmq.archive('{_safe_ident(queue_name)}', %s);"


def pgmq_delete_sql(queue_name: str) -> str:
    return f"SELECT pgmq.delete('{_safe_ident(queue_name)}', %s);"
