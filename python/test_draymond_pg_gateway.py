"""Tests for the Draymond PG gateway contract (Magda Ch3/Ch9/Ch11 wiring).
Run: python test_draymond_pg_gateway.py
"""
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import draymond_pg_gateway as gw  # noqa: E402
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


def test_health():
    print("gateway.health:")
    s, p = gw.dispatch("GET", "/health", {}, {})
    check(s == 200 and p["status"] == "ok", "health ok")
    check(p["backend"] == "memory", "in-memory backend when no DATABASE_URL")


def test_queue():
    print("gateway.queue:")
    s, p = gw.dispatch("POST", "/queue/enqueue", {}, {"message": {"chain": "a"}})
    check(s == 200 and "msg_id" in p, "enqueue returns msg_id")
    s, p = gw.dispatch("POST", "/queue/dequeue", {}, {})
    check(s == 200 and p["items"] and p["items"][0]["message"]["chain"] == "a",
          "dequeue returns the enqueued message")
    mid = p["items"][0]["msg_id"]
    s, p = gw.dispatch("POST", "/queue/complete", {}, {"ids": [mid]})
    check(s == 200 and p["marked"] == 1, "mark_completed accepts ids")


def test_dag():
    print("gateway.dag:")
    gw.dispatch("POST", "/dag/edge", {}, {"chain_id": "transform", "depends_on": "ingest"})
    gw.dispatch("POST", "/dag/edge", {}, {"chain_id": "train", "depends_on": "transform"})
    s, p = gw.dispatch("GET", "/dag/ancestors", {"chain": "train"}, {})
    chains = {c for c, _ in p["ancestors"]}
    check(s == 200 and chains == {"train", "transform", "ingest"},
          "ancestors(train) = train, transform, ingest")
    levels = gw.dispatch("GET", "/dag/levels", {}, {})[1]["levels"]
    check(levels == {"ingest": 1, "transform": 2, "train": 3},
          "topological_levels assign depth")
    s, p = gw.dispatch("POST", "/dag/edge", {},
                       {"chain_id": "ingest", "depends_on": "train"})  # would cycle
    check(s == 409 and "cycle" in p["error"].lower(), "cycle edge rejected (409)")


def test_ts():
    print("gateway.ts:")
    for mm in [45, 46, 47, 48, 49]:
        gw.dispatch("POST", "/ts/sample", {}, {
            "agent_id": "3",
            "recorded_at": f"2025-12-01T00:{mm:02d}:00+00:00",
            "value": 48,
        })
    gw.dispatch("POST", "/ts/aggregate", {}, {"bucket": "5 minutes", "low_threshold": 50})
    s, p = gw.dispatch("GET", "/ts/window",
                       {"start": "2025-12-01T00:45:00+00:00",
                        "end": "2025-12-01T00:50:00+00:00",
                        "agent": "3", "flag_threshold": "5"}, {})
    check(s == 200 and len(p["rows"]) == 1, "one 5-min bucket aggregated")
    check(p["rows"][0]["low_count"] == 5 and p["rows"][0]["outlier_detected"] is True,
          "outlier flag set (5 low samples)")


if __name__ == "__main__":
    test_health()
    test_queue()
    test_dag()
    test_ts()
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
