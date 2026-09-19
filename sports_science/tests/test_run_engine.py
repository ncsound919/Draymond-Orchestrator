# sports_science/tests/test_run_engine.py
import json

from sports_science.run_engine import _main


def test_list_contains_registered_engines(capsys):
    assert _main(["--list"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["ok"] is True
    assert "adjusted_plus_minus" in payload["engines"]
    assert "verify_strategy" in payload["engines"]


def test_registry_reports_lockfile_and_clean_drift(capsys):
    assert _main(["--registry"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["ok"] is True
    assert payload["count"] >= 14
    assert len(payload["lockfile"]["sha256"]) == 64
    assert payload["drift"]["status"] == "ok"


def test_engine_runs_and_returns_output(capsys):
    assert _main(["--engine", "adjusted_plus_minus"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["ok"] is True
    assert payload["engine"] == "adjusted_plus_minus"
    assert "coefficients" in payload["output"]


def test_unknown_engine_exits_nonzero(capsys):
    assert _main(["--engine", "does_not_exist"]) == 1
    payload = json.loads(capsys.readouterr().out)
    assert payload["ok"] is False
