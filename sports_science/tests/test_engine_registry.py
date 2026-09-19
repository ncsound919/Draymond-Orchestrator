# sports_science/tests/test_engine_registry.py
import json

from sports_science.engine_registry import ENGINES, LOCKFILE_PATH, snapshot_all_engines
from sports_science.run_drift import drift_lines


def test_lockfile_reproduces():
    expected = json.loads(LOCKFILE_PATH.read_text(encoding="utf-8"))
    current = snapshot_all_engines()
    by_name = {e["engine"]: e for e in expected}
    assert {e["engine"] for e in current} == set(by_name)
    for e in current:
        assert e["version"] == by_name[e["engine"]]["version"]
        assert e["inputsHash"] == by_name[e["engine"]]["inputsHash"]
        assert e["output"] == by_name[e["engine"]]["output"]


def test_snapshot_is_deterministic():
    assert snapshot_all_engines() == snapshot_all_engines()


def test_engine_names_unique_and_versioned():
    names = [e.name for e in ENGINES]
    assert len(names) == len(set(names))
    for e in ENGINES:
        assert e.version.count(".") == 2


def test_drift_lines_detects_numeric_change():
    cur = [{"engine": "x", "version": "1.0.0", "inputsHash": "a" * 64, "output": {"v": 0.5}}]
    same = [{"engine": "x", "version": "1.0.0", "inputsHash": "a" * 64, "output": {"v": 0.5}}]
    changed = [{"engine": "x", "version": "1.0.0", "inputsHash": "a" * 64, "output": {"v": 0.5 + 1e-3}}]
    assert drift_lines(cur, same) == []
    assert drift_lines(cur, changed)


def test_drift_lines_detects_new_engine():
    cur = [{"engine": "x", "version": "1.0.0", "inputsHash": "a" * 64, "output": {}}]
    assert drift_lines(cur, [])
