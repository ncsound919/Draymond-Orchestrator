"""Tests for the Draymond Postgres message-queue (Magda Ch11).
Run: python tests/test_draymond_queue.py
"""
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import draymond_queue as mq  # noqa: E402

# Stub psycopg2 so PgCustomQueue can be constructed without the driver.
sys.modules.setdefault("psycopg2", types.ModuleType("psycopg2"))

passed = 0
failed = 0


def check(cond, msg):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok - {msg}")
    else:
        failed += 1
        print(f"  FAIL - {msg}")


def test_ddl():
    print("draymond_queue.ddl:")
    ddl = mq.custom_queue_ddl()
    joined = "\n".join(ddl)
    check("CREATE SCHEMA IF NOT EXISTS mq;" in joined, "schema mq created")
    check("CREATE TYPE IF NOT EXISTS mq.status AS ENUM ('new', 'processing', 'completed')" in joined,
          "status enum new/processing/completed (Listing 11.1)")
    check("CREATE TABLE IF NOT EXISTS mq.queue (" in joined, "mq.queue table created")
    check("BIGSERIAL PRIMARY KEY" in joined, "id BIGSERIAL primary key")
    check("message JSON NOT NULL" in joined, "message JSON column")
    check("WHERE status = 'new'" in joined, "partial index skips non-new rows (§11.5.2)")

    part = "\n".join(mq.custom_queue_ddl(partitioned=True, partition_by_day=True))
    check("PARTITION BY RANGE (created_at)" in part, "range partition by created_at (§11.5.3)")
    check("PARTITION OF mq.queue DEFAULT" in part, "default partition created")

    enq, enq_call = mq.enqueue_sql(notify=False)
    check("INSERT INTO mq.queue (message) VALUES (new_message);" in enq, "enqueue INSERT (Listing 11.2)")
    enq_n, enq_n_call = mq.enqueue_sql(notify=True)
    check("PERFORM pg_notify('queue_new_message', 'new_message');" in enq_n,
          "notify enqueue fires pg_notify (Listing 11.5)")
    check(enq_call == "SELECT mq.enqueue(%s::json);", "enqueue call passes JSON param")

    dq = mq.dequeue_sql()
    check("FOR UPDATE SKIP LOCKED" in dq, "dequeue uses FOR UPDATE SKIP LOCKED (Listing 11.3)")
    check("WHERE status = 'new' ORDER BY created_at" in dq, "dequeue FIFO on created_at")
    check("SET status = 'processing'" in dq, "dequeue claims as processing")
    check("date_trunc('seconds'" in dq, "dequeue truncates created_at to seconds")

    mc = mq.mark_completed_sql()
    check("DELETE FROM mq.queue WHERE id = ANY(message_ids);" in mc, "mark_completed delete branch (Listing 11.4)")
    check("UPDATE mq.queue SET status = 'completed'" in mc, "mark_completed update branch")

    pg = "\n".join(mq.pgmq_ddl("draymond"))
    check("CREATE EXTENSION IF NOT EXISTS pgmq;" in pg, "pgmq extension enabled (§11.6)")
    check("pgmq.create('draymond')" in pg, "pgmq.create queue (§11.7)")

    fo = "\n".join(mq.failover_ddl())
    check("ADD COLUMN IF NOT EXISTS processing_since" in fo, "failover adds processing_since (§11.5.4)")


def test_inmemory_lifecycle():
    print("draymond_queue.inmemory:")
    q = mq.InMemoryMessageQueue(channel="queue_new_message", ttl_seconds=300)
    a = q.enqueue({"visitor": "Emily"})
    b = q.enqueue({"visitor": "Liam"})
    c = q.enqueue({"visitor": "Ava"})

    first = q.dequeue(1)
    check(first[0]["msg_id"] == a, "FIFO: first dequeued is earliest enqueued")
    # SKIP-LOCKED equivalence: a second dequeue must NOT return claimed message a.
    second = q.dequeue(1)
    check(second[0]["msg_id"] == b, "claimed message invisible to next dequeue (SKIP LOCKED)")
    check(q.dequeue(1)[0]["msg_id"] == c, "third dequeue returns remaining new message")

    q.mark_completed([a])
    states = dict(q._raw_state())
    check(states[a] == "completed", "mark_completed sets completed")
    # delete path
    q.mark_completed([b, c], delete=True)
    ids = {s[0] for s in q._raw_state()}
    check(b not in ids and c not in ids, "mark_completed(delete=True) removes rows")


def test_inmemory_notify():
    print("draymond_queue.notify:")
    q = mq.InMemoryMessageQueue(channel="queue_new_message")
    got = []
    q.listen("queue_new_message", lambda ch, payload: got.append((ch, payload)))
    q.enqueue({"visitor": "Marta"})
    check(len(got) == 1, "enqueue fires LISTEN/NOTIFY callback (§11.4)")
    check(got[0][0] == "queue_new_message" and "Marta" in got[0][1], "notify delivers channel + payload")


def test_inmemory_failover():
    print("draymond_queue.failover:")
    q = mq.InMemoryMessageQueue(channel="x", ttl_seconds=10)
    mid = q.enqueue({"job": "1"})
    q.dequeue(1)  # claims -> processing
    # Force staleness by using ttl=0 so claimed_at is now older than ttl.
    reset = q.requeue_stale(ttl_seconds=0.0)
    check(reset == 1, "requeue_stale resets 1 stuck-processing message (§11.5.4)")
    check(dict(q._raw_state())[mid] == "new", "reset message back to new for another worker")


class _FakeCursor:
    def __init__(self):
        self.calls = []
        self._rowcount = 1
        self._rows = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))

    def fetchall(self):
        return self._rows

    @property
    def rowcount(self):
        return self._rowcount

    def close(self):
        pass


class _FakeConn:
    def __init__(self):
        self._cur = _FakeCursor()
        self.commits = 0

    def cursor(self):
        return self._cur

    def commit(self):
        self.commits += 1


def test_pg_custom_sql():
    print("draymond_queue.pg_custom:")
    conn = _FakeConn()
    q = mq.PgCustomQueue(conn, channel="queue_new_message")
    q.enqueue({"visitor": "Emily"}, notify=True)
    sql, params = conn._cur.calls[0]
    check("SELECT mq.enqueue(%s::json);" in sql, "enqueue issues SELECT mq.enqueue(%s::json)")
    check(isinstance(params[0], str) and "Emily" in params[0], "message JSON passed as param")

    conn2 = _FakeConn()
    q2 = mq.PgCustomQueue(conn2)
    q2.dequeue(3)
    sql2, params2 = conn2._cur.calls[0]
    check("SELECT * FROM mq.dequeue(%s);" in sql2 and params2 == (3,), "dequeue calls mq.dequeue(3)")

    conn3 = _FakeConn()
    q3 = mq.PgCustomQueue(conn3)
    q3.mark_completed(["1", "2"], delete=True)
    sql3, params3 = conn3._cur.calls[0]
    check("SELECT mq.mark_completed(%s, %s);" in sql3, "mark_completed issues mq.mark_completed")
    check(params3 == ([1, 2], True), "ids cast to int, delete flag passed")

    conn4 = _FakeConn()
    q4 = mq.PgCustomQueue(conn4)
    n = q4.requeue_stale(60.0)
    sql4, params4 = conn4._cur.calls[0]
    check("status='processing'" in sql4 and "processing_since" in sql4, "failover resets stuck processing via processing_since")
    check(params4 == (60.0,), "ttl passed to interval expression")


if __name__ == "__main__":
    test_ddl()
    test_inmemory_lifecycle()
    test_inmemory_notify()
    test_inmemory_failover()
    test_pg_custom_sql()
    print(f"\n{passed} passed, {failed} failed")
    if failed:
        sys.exit(1)
