# sports_science/tests/test_runners.py
import json
from sports_science.run_metrics import compute_metrics_from_json, compute_metrics_from_raw
from sports_science.run_coach import build_gameplan
from sports_science.run_insights import _derived_profile
from science_bridge.insights import synthesize


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
    assert out["evidence_tier"] == "E2"


def test_compute_metrics_from_raw_derives_real_four_factors():
    # No explicit proliferation/clearance fields -> derived from the real line,
    # NOT flat 50 defaults (the pre-upgrade bug left four_factors uniform).
    out = compute_metrics_from_raw({
        "performance": {"fg": 85.0, "tp": 92.0, "ast": 55.0, "oreb": 65.0,
                        "tov": -68.0, "pf": -78.0, "defensive_attention": 0.8,
                        "court_spacing": 0.6},
        "biometrics": {"hrv": 50.0, "load": 0.9, "acute_chronic": 1.4, "sleep_hrs": 5.0},
    })
    ff = out["four_factors"]
    assert len({round(v, 3) for v in ff.values()}) >= 2  # not all equal
    assert ff["proliferation"] > 40


def test_insights_from_raw_profile_emit_real_metrics():
    profile = {
        "sport": "basketball",
        "performance": {"fg": 85.0, "tp": 92.0, "ast": 55.0, "oreb": 65.0,
                        "tov": -68.0, "pf": -78.0, "defensive_attention": 0.8,
                        "court_spacing": 0.6},
        "biometrics": {"hrv": 50.0, "load": 0.9, "acute_chronic": 1.4, "sleep_hrs": 5.0},
    }
    report = synthesize(_derived_profile(profile, "sports"), from_domain="sports")
    assert len(report.translated_metrics) >= 4
    assert report.source_read != "no profile metrics detected"
    assert any(m.metric == "proliferation" for m in report.translated_metrics)


def test_derived_profile_normalizes_injury_risk_to_fraction():
    profile = {
        "performance": {"fg": 50.0, "tp": 0.0, "ast": 2.0, "oreb": 3.0,
                        "tov": -2.0, "pf": -3.0, "defensive_attention": 0.6,
                        "court_spacing": 0.0},
        "biometrics": {"hrv": 65.0, "load": 0.7, "acute_chronic": 1.0, "sleep_hrs": 7.0},
    }
    d = _derived_profile(profile, "sports")
    assert 0.0 <= d["injury_risk"] <= 1.0


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

