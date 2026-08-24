"""Tests for TimescaleDB hypertables + continuous aggregates (Magda Ch9).
Run: python test_timeseries.py
"""
import os
import sys
import types
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import timeseries as m  # noqa: E402

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
    print("timeseries.ddl:")
    ext = "\n".join(m.extension_ddl())
    check("CREATE EXTENSION IF NOT EXISTS timescaledb;" in ext, "timescaledb extension")

    tbl = "\n".join(m.metrics_table_ddl())
    check("CREATE TABLE IF NOT EXISTS agent_metric_samples (" in tbl,
          "raw metrics table created")
    check("recorded_at TIMESTAMPTZ NOT NULL" in tbl, "recorded_at timestamptz")
    check("metric_value DOUBLE PRECISION NOT NULL" in tbl, "metric_value column")

    ht = m.create_hypertable_sql()
    check("SELECT create_hypertable(" in ht, "create_hypertable call (§9.4)")
    check("relation => 'agent_metric_samples'" in ht, "relation named arg")
    check("dimension => by_range('recorded_at', interval '1 day')" in ht,
          "by_range dimension (Listing 9.4)")
    check("create_default_indexes => false" in ht, "default indexes disabled")


def test_continuous_aggregate_sql():
    print("timeseries.continuous_aggregate:")
    sql = m.create_continuous_aggregate_sql(
        "watch.low_heart_rate_count_per_5min", "watch.heart_rate_measurements",
        time_col="recorded_at", bucket="5 minutes", entity_col="watch_id",
        value_col="heart_rate", low_threshold=50, min_col="min_rate",
        low_col="low_rate_count", total_col="total_measurements")
    check("CREATE MATERIALIZED VIEW watch.low_heart_rate_count_per_5min" in sql,
          "CREATE MATERIALIZED VIEW (Listing 9.14)")
    check("WITH (timescaledb.continuous) AS" in sql,
          "WITH (timescaledb.continuous) (Listing 9.14)")
    check("time_bucket('5 minutes', recorded_at) AS bucket" in sql,
          "time_bucket for the bucket (Listing 9.14)")
    check("MIN(heart_rate) AS min_rate" in sql, "MIN aggregate for min_rate")
    check("COUNT(*) FILTER (WHERE heart_rate < 50) AS low_rate_count" in sql,
          "COUNT(*) FILTER (WHERE ...) for low_rate_count (Listing 9.14)")
    check("COUNT(*) AS total_measurements" in sql, "total count")
    check("GROUP BY watch_id, bucket;" in sql, "GROUP BY entity, bucket")


def test_refresh_policy_sql():
    print("timeseries.refresh_policy:")
    pol = m.add_refresh_policy_sql("watch.low_heart_rate_count_per_5min")
    check("SELECT add_continuous_aggregate_policy" in pol,
          "add_continuous_aggregate_policy (Listing 9.18)")
    check("start_offset => INTERVAL '15 minutes'" in pol, "start_offset 15 min")
    check("end_offset => INTERVAL '1 minute'" in pol, "end_offset 1 min")
    check("schedule_interval => INTERVAL '1 minute'" in pol, "schedule every 1 min")

    ref = m.refresh_sql(
        "watch.low_heart_rate_count_per_5min",
        "2025-12-01 00:45:00+00", "2025-12-01 00:50:00+00")
    check("CALL refresh_continuous_aggregate('watch.low_heart_rate_count_per_5min'," in ref,
          "refresh_continuous_aggregate CALL (Listing 9.19)")
    check("'2025-12-01 00:45:00+00', '2025-12-01 00:50:00+00'" in ref,
          "refresh window bounds")


def test_query_window_sql():
    print("timeseries.query_window:")
    q = m.query_window_sql(
        "watch.low_heart_rate_count_per_5min",
        "2025-11-30 02:35", "2025-11-30 02:45",
        entity_col="watch_id", entity_val="3", low_col="low_rate_count",
        flag_threshold=5, flag_col="bradycardia_detected")
    check("SELECT bucket, low_rate_count, (low_rate_count >= 5) AS bradycardia_detected" in q,
          "select with >=5 flag (Listing 9.15/9.16)")
    check("FROM watch.low_heart_rate_count_per_5min" in q, "reads the continuous aggregate")
    check("WHERE bucket BETWEEN '2025-11-30 02:35' AND '2025-11-30 02:45' AND watch_id = '3'" in q,
          "window + entity filter")
    check(q.strip().endswith("ORDER BY bucket;"), "orders by bucket")


def test_time_bucket():
    print("timeseries.time_bucket:")
    base = datetime(2025, 11, 30, 2, 37, 0, tzinfo=timezone.utc)
    b = m.time_bucket("5 minutes", base)
    check(b == datetime(2025, 11, 30, 2, 35, 0, tzinfo=timezone.utc),
          "floors to 5-min boundary (02:35)")
    b2 = m.time_bucket("1 hour", datetime(2025, 12, 1, 0, 47, 0, tzinfo=timezone.utc))
    check(b2 == datetime(2025, 12, 1, 0, 0, 0, tzinfo=timezone.utc), "floors to hour")
    # Next 5-min bucket after 02:35 is 02:40.
    b3 = m.time_bucket("5 minutes", datetime(2025, 11, 30, 2, 40, 1, tzinfo=timezone.utc))
    check(b3 == datetime(2025, 11, 30, 2, 40, 0, tzinfo=timezone.utc), "next bucket 02:40")


def test_inmemory():
    print("timeseries.inmemory:")
    ts = m.InMemoryTimeSeries()
    # Insert 7 low readings in the 00:45 five-minute window for agent 3 (Magda 9.19).
    for mm in [45, 46, 47, 47, 48, 48, 49]:
        ts.add_sample("3", datetime(2025, 12, 1, 0, mm, 0, tzinfo=timezone.utc),
                      48 if mm != 49 else 43)
    ts.create_continuous_aggregate(bucket="5 minutes", low_threshold=50)
    rows = ts.query_window(
        datetime(2025, 12, 1, 0, 45, tzinfo=timezone.utc),
        datetime(2025, 12, 1, 0, 50, tzinfo=timezone.utc), "3", flag_threshold=5)
    check(len(rows) == 1, "one 5-min bucket aggregated")
    check(rows[0]["low_count"] == 7, "low_count = 7 (all < 50) (Magda 9.19)")
    check(rows[0]["outlier_detected"] is True, "outlier flag set (>=5)")
    check(rows[0]["min_value"] == 43, "min_value = 43")

    # Agent 9 has only 2 low readings in the same window -> not an outlier.
    ts.add_sample("9", datetime(2025, 12, 1, 0, 46, 0, tzinfo=timezone.utc), 48)
    ts.add_sample("9", datetime(2025, 12, 1, 0, 47, 0, tzinfo=timezone.utc), 49)
    ts.refresh(datetime(2025, 12, 1, 0, 45, tzinfo=timezone.utc),
               datetime(2025, 12, 1, 0, 50, tzinfo=timezone.utc))
    r9 = ts.query_window(
        datetime(2025, 12, 1, 0, 45, tzinfo=timezone.utc),
        datetime(2025, 12, 1, 0, 50, tzinfo=timezone.utc), "9", flag_threshold=5)
    check(r9[0]["low_count"] == 2 and r9[0]["outlier_detected"] is False,
          "agent 9 not flagged (2 < 5 threshold)")


# --------------------------------------------------------------------------
class _FakeCursor:
    def __init__(self):
        self.calls = []
        self._rows = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))

    def fetchall(self):
        return self._rows

    def close(self):
        pass


class _FakeConn:
    def __init__(self):
        self.cur = _FakeCursor()
        self.committed = False

    def cursor(self):
        return self.cur

    def commit(self):
        self.committed = True


def test_pg():
    print("timeseries.pg:")
    conn = _FakeConn()
    ts = m.PgTimeSeries(conn)
    ts.add_sample("3", datetime(2025, 12, 1, 0, 45, tzinfo=timezone.utc), 48)
    check(conn.committed, "add_sample commits")
    check("INSERT INTO agent_metric_samples" in conn.cur.calls[0][0],
          "add_sample INSERTs")

    conn2 = _FakeConn()
    t2 = m.PgTimeSeries(conn2)
    t2.create_continuous_aggregate(bucket="5 minutes", low_threshold=50)
    expect = m.create_continuous_aggregate_sql(
        "agent_metrics_per_bucket", "agent_metric_samples",
        bucket="5 minutes", low_threshold=50)
    check(conn2.cur.calls[0][0] == expect,
          "create_continuous_aggregate emits exact SQL")

    conn3 = _FakeConn()
    t3 = m.PgTimeSeries(conn3)
    t3.refresh(datetime(2025, 12, 1, 0, 45, tzinfo=timezone.utc),
               datetime(2025, 12, 1, 0, 50, tzinfo=timezone.utc))
    check(conn3.cur.calls[0][0] == m.refresh_sql(
        "agent_metrics_per_bucket",
        "2025-12-01T00:45:00+00:00", "2025-12-01T00:50:00+00:00"),
        "refresh emits exact CALL")


if __name__ == "__main__":
    test_ddl()
    test_continuous_aggregate_sql()
    test_refresh_policy_sql()
    test_query_window_sql()
    test_time_bucket()
    test_inmemory()
    test_pg()
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
