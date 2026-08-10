# sports_science/tests/test_runners.py
import json
from sports_science.run_metrics import compute_metrics_from_json
from sports_science.run_coach import build_gameplan


def test_compute_metrics_from_json(tmp_path):
    data = {
        "sport": "basketball",
        "performance": {"fg": 85.0, "tp": 92.0, "ast": 55.0, "oreb": 65.0, "tov": -68.0, "pf": -78.0},
        "biometrics": {"hrv": 50.0, "load": 0.9, "acute_chronic": 1.4, "sleep_hrs": 5.0},
    }
    src = tmp_path / "input.json"
    src.write_text(json.dumps(data))
    out = compute_metrics_from_json(src)
    assert "ter" in out and "injury_risk" in out
    assert out["evidence_tier"] == "E1"


def test_build_gameplan_requires_metrics():
    plan = build_gameplan(sport="boxing", metrics_file=None)
    assert plan["status"] == "error"
    assert plan["message"] == "metrics required"


def test_build_gameplan_accepts_metrics_dict():
    plan = build_gameplan(
        sport="boxing",
        metrics_file={"ter": 12.0, "gravity": 0.6, "recovery_priority": "normal"},
    )
    assert plan["status"] == "ok"
    assert plan["ter"] == 12.0
    assert plan["focus"] == "maintain spacing"  # gravity 0.6 >= 0.5


def test_build_gameplan_unreadable_file_returns_error(tmp_path):
    missing = tmp_path / "missing.json"
    plan = build_gameplan(sport="boxing", metrics_file=str(missing))
    assert plan["status"] == "error"
    assert "unreadable" in plan["message"]

