"""TimescaleDB hypertables + continuous aggregates for Draymond telemetry.

Faithful port of Magda, *Just Use Postgres!* (2026), Chapter 9 "Postgres for
time series":
  * §9.4  Hypertables via create_hypertable with the `by_range` dimension
          (Listing 9.4: `dimension => by_range('recorded_at', interval '1
          month')`, `create_default_indexes => false`).
  * §9.5  time_bucket(bucket_width, ts, [origin, timezone, offset]) (Listing
          9.9); we use the UTC-aligned default (Magda §9.5.1).
  * §9.6  Continuous aggregates (Listing 9.14: `CREATE MATERIALIZED VIEW ...
          WITH (timescaledb.continuous) AS SELECT entity, time_bucket(...) AS
          bucket, MIN(...), COUNT(*) FILTER (WHERE ...), COUNT(*) ... GROUP BY
          entity, bucket`), refresh policy (Listing 9.18:
          add_continuous_aggregate_policy with start_offset/end_offset/
          schedule_interval), and manual refresh (Listing 9.19:
          CALL refresh_continuous_aggregate(view, start, end)).

Use case: Draymond records per-agent execution telemetry (latency, token
usage, error counts) over time. The hypertable partitions it by time; a
continuous aggregate precomputes per-(agent, bucket) rollups (min latency,
count of "low/outlier" samples, total) so dashboards stay fast without
re-scanning raw rows.

As with the other book-scan extractions, Draymond runs without a live
Postgres, so this module yields the exact TimescaleDB DDL/SQL (test-validated,
deploy-ready) AND a pure-Python `InMemoryTimeSeries` that computes the same
time_bucket rollups offline. Both implement `TimeSeries`.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# DDL + TimescaleDB SQL (Magda §9.4-9.6)
# ---------------------------------------------------------------------------
def extension_ddl() -> List[str]:
    return ["CREATE EXTENSION IF NOT EXISTS timescaledb;"]


def metrics_table_ddl(table: str = "agent_metric_samples") -> List[str]:
    return [
        f"CREATE TABLE IF NOT EXISTS {table} ("
        "  agent_id TEXT NOT NULL,"
        "  recorded_at TIMESTAMPTZ NOT NULL,"
        "  metric_value DOUBLE PRECISION NOT NULL,"
        "  PRIMARY KEY (agent_id, recorded_at)"
        ");",
    ]


def create_hypertable_sql(
    table: str = "agent_metric_samples",
    time_col: str = "recorded_at",
    interval: str = "1 day",
    create_default_indexes: bool = False,
) -> str:
    """§9.4 create_hypertable with the modern by_range dimension."""
    idx = "true" if create_default_indexes else "false"
    return (
        f"SELECT create_hypertable(\n"
        f"  relation => '{table}',\n"
        f"  dimension => by_range('{time_col}', interval '{interval}'),\n"
        f"  create_default_indexes => {idx}\n"
        f");"
    )


def create_continuous_aggregate_sql(
    view: str,
    source_table: str = "agent_metric_samples",
    time_col: str = "recorded_at",
    bucket: str = "5 minutes",
    entity_col: str = "agent_id",
    value_col: str = "metric_value",
    low_threshold: float = 50.0,
    min_col: str = "min_value",
    low_col: str = "low_count",
    total_col: str = "total",
) -> str:
    """§9.6.1 Listing 9.14 — materialized view WITH (timescaledb.continuous)."""
    return (
        f"CREATE MATERIALIZED VIEW {view}\n"
        f"WITH (timescaledb.continuous) AS\n"
        f"SELECT\n"
        f"  {entity_col},\n"
        f"  time_bucket('{bucket}', {time_col}) AS bucket,\n"
        f"  MIN({value_col}) AS {min_col},\n"
        f"  COUNT(*) FILTER (WHERE {value_col} < {_num(low_threshold)}) AS {low_col},\n"
        f"  COUNT(*) AS {total_col}\n"
        f"FROM {source_table}\n"
        f"GROUP BY {entity_col}, bucket;"
    )


def add_refresh_policy_sql(
    view: str,
    start_offset: str = "15 minutes",
    end_offset: str = "1 minute",
    schedule_interval: str = "1 minute",
) -> str:
    """§9.6.2 Listing 9.18 — add_continuous_aggregate_policy."""
    return (
        f"SELECT add_continuous_aggregate_policy\n"
        f"  ('{view}',\n"
        f"  start_offset => INTERVAL '{start_offset}',\n"
        f"  end_offset => INTERVAL '{end_offset}',\n"
        f"  schedule_interval => INTERVAL '{schedule_interval}');"
    )


def refresh_sql(view: str, start: str, end: str) -> str:
    """§9.6.2 Listing 9.19 — manual refresh of a window."""
    return (
        f"CALL refresh_continuous_aggregate('{view}',\n"
        f"    '{start}', '{end}');"
    )


def query_window_sql(
    view: str,
    start: str,
    end: str,
    entity_col: str = "agent_id",
    entity_val: str = "3",
    low_col: str = "low_count",
    flag_threshold: int = 5,
    flag_col: str = "outlier_detected",
) -> str:
    """§9.6.1 Listing 9.15/9.16 — query the precomputed rollup by window."""
    return (
        f"SELECT bucket, {low_col}, "
        f"({low_col} >= {flag_threshold}) AS {flag_col}\n"
        f"FROM {view}\n"
        f"WHERE bucket BETWEEN '{start}' AND '{end}' AND {entity_col} = '{entity_val}'\n"
        f"ORDER BY bucket;"
    )


def _num(x: float) -> str:
    if float(x).is_integer():
        return str(int(x))
    return repr(float(x))


# ---------------------------------------------------------------------------
# time_bucket (UTC-aligned, Magda §9.5.1 default)
# ---------------------------------------------------------------------------
_INTERVAL_RE = re.compile(
    r"^\s*(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks|second|seconds)\s*$"
)


def parse_interval(bucket_width: str) -> timedelta:
    m = _INTERVAL_RE.match(bucket_width)
    if not m:
        raise ValueError(f"unsupported bucket width: {bucket_width!r}")
    n = int(m.group(1))
    unit = m.group(2)
    if unit.startswith("second"):
        return timedelta(seconds=n)
    if unit.startswith("minute"):
        return timedelta(minutes=n)
    if unit.startswith("hour"):
        return timedelta(hours=n)
    if unit.startswith("day"):
        return timedelta(days=n)
    if unit.startswith("week"):
        return timedelta(weeks=n)
    raise ValueError(f"unsupported bucket width: {bucket_width!r}")


def time_bucket(bucket_width: str, ts: datetime, origin: Optional[datetime] = None) -> datetime:
    """Floor `ts` to the start of its bucket (UTC-aligned by default, Magda §9.5.1)."""
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    else:
        ts = ts.astimezone(timezone.utc)
    base = origin if origin is not None else datetime(1970, 1, 1, tzinfo=timezone.utc)
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    td = parse_interval(bucket_width)
    delta = ts - base
    # floor to whole number of buckets from base
    n_buckets = int(delta // td)
    return base + n_buckets * td


# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------
class TimeSeries:
    def add_sample(self, agent_id: str, recorded_at: datetime, value: float) -> None:
        raise NotImplementedError

    def create_continuous_aggregate(self, bucket: str = "5 minutes",
                                     low_threshold: float = 50.0) -> None:
        raise NotImplementedError

    def refresh(self, start: datetime, end: datetime) -> None:
        raise NotImplementedError

    def query_window(self, start: datetime, end: datetime, agent_id: str,
                     flag_threshold: int = 5) -> List[Dict]:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Pure-Python fallback (offline time_bucket rollups)
# ---------------------------------------------------------------------------
class InMemoryTimeSeries(TimeSeries):
    def __init__(self, entity_col: str = "agent_id", value_col: str = "metric_value"):
        self._entity_col = entity_col
        self._value_col = value_col
        self._samples: List[Tuple[str, datetime, float]] = []
        self._cfg: Optional[Dict] = None
        self._agg: Dict[Tuple[str, datetime], Dict[str, float]] = {}

    def add_sample(self, agent_id: str, recorded_at: datetime, value: float) -> None:
        self._samples.append((agent_id, recorded_at, float(value)))

    def create_continuous_aggregate(self, bucket: str = "5 minutes",
                                     low_threshold: float = 50.0) -> None:
        self._cfg = {"bucket": bucket, "low_threshold": low_threshold}
        self._agg = {}
        self._recompute(self._samples)

    def _recompute(self, samples: List[Tuple[str, datetime, float]]) -> None:
        if not self._cfg:
            return
        bucket = self._cfg["bucket"]
        thr = self._cfg["low_threshold"]
        for agent, ts, val in samples:
            b = time_bucket(bucket, ts)
            key = (agent, b)
            row = self._agg.setdefault(key, {"min_value": val, "low_count": 0, "total": 0})
            row["min_value"] = min(row["min_value"], val)
            if val < thr:
                row["low_count"] += 1
            row["total"] += 1

    def refresh(self, start: datetime, end: datetime) -> None:
        if not self._cfg:
            raise RuntimeError("continuous aggregate not created")
        # Drop then rebuild buckets overlapping [start, end).
        start_b = time_bucket(self._cfg["bucket"], start)
        end_b = time_bucket(self._cfg["bucket"], end)
        for key in list(self._agg):
            if start_b <= key[1] <= end_b:
                del self._agg[key]
        relevant = [s for s in self._samples if start <= s[1] < end]
        self._recompute(relevant)

    def query_window(self, start: datetime, end: datetime, agent_id: str,
                     flag_threshold: int = 5) -> List[Dict]:
        if not self._cfg:
            raise RuntimeError("continuous aggregate not created")
        rows = []
        for (agent, b), row in self._agg.items():
            if agent == agent_id and start <= b <= end:
                rows.append({
                    "bucket": b,
                    "low_count": row["low_count"],
                    "min_value": row["min_value"],
                    "total": row["total"],
                    "outlier_detected": row["low_count"] >= flag_threshold,
                })
        return sorted(rows, key=lambda r: r["bucket"])


# ---------------------------------------------------------------------------
# Psycopg2-backed TimeSeries (deploy path; emits exact TimescaleDB SQL)
# ---------------------------------------------------------------------------
class PgTimeSeries(TimeSeries):
    def __init__(self, conn, table: str = "agent_metric_samples"):
        import psycopg2  # noqa: F401 (lazy)
        self._conn = conn
        self._table = table

    def add_sample(self, agent_id: str, recorded_at: datetime, value: float) -> None:
        cur = self._conn.cursor()
        try:
            cur.execute(
                f"INSERT INTO {self._table} (agent_id, recorded_at, metric_value) "
                "VALUES (%s, %s, %s);",
                (agent_id, recorded_at.isoformat(), float(value)),
            )
            self._conn.commit()
        finally:
            cur.close()

    def create_continuous_aggregate(self, bucket: str = "5 minutes",
                                     low_threshold: float = 50.0) -> None:
        cur = self._conn.cursor()
        try:
            cur.execute(create_continuous_aggregate_sql(
                "agent_metrics_per_bucket", self._table,
                bucket=bucket, low_threshold=low_threshold))
            self._conn.commit()
        finally:
            cur.close()

    def refresh(self, start: datetime, end: datetime) -> None:
        cur = self._conn.cursor()
        try:
            cur.execute(refresh_sql(
                "agent_metrics_per_bucket",
                start.isoformat(), end.isoformat()))
            self._conn.commit()
        finally:
            cur.close()

    def query_window(self, start: datetime, end: datetime, agent_id: str,
                     flag_threshold: int = 5) -> List[Dict]:
        cur = self._conn.cursor()
        try:
            cur.execute(query_window_sql(
                "agent_metrics_per_bucket", start.isoformat(), end.isoformat(),
                entity_val=agent_id, flag_threshold=flag_threshold))
            rows = cur.fetchall()
            return [
                {"bucket": r[0], "low_count": r[1], "outlier_detected": r[2]}
                for r in rows
            ]
        finally:
            cur.close()
