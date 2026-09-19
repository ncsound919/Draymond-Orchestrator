# sports_science/tests/test_registry_api.py
import json

from sports_science.engine_registry import snapshot_all_engines
from sports_science.registry_api import (
    build_drift_response,
    build_health_response,
    build_registry_response,
)


def _payload(response):
    status, headers, body = response
    assert any(h[0].lower() == "content-type" for h in headers)
    return status, json.loads(body)


def test_registry_response_lists_lockfile_pinned_engines():
    status, payload = _payload(build_registry_response())
    assert status == 200
    assert payload["ok"] is True
    assert payload["count"] == len(snapshot_all_engines())
    names = {e["engine"] for e in payload["engines"]}
    assert "adjusted_plus_minus" in names
    assert len(payload["lockfile"]["sha256"]) == 64


def test_drift_response_clean():
    status, payload = _payload(build_drift_response())
    assert status == 200
    assert payload["status"] == "ok"
    assert payload["drifted"] == []


def test_health_response_has_lockfile_and_drift():
    status, payload = _payload(build_health_response())
    assert status == 200
    assert payload["ok"] is True
    assert len(payload["lockfile"]["sha256"]) == 64
    assert payload["drift"]["status"] == "ok"
