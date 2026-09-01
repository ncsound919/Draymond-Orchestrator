# sports_science/tests/test_evidence_tiers.py
"""No output may claim E1 (measured) for derived/rule-based/failed outputs."""
from sports_science.run_metrics import compute_metrics_from_raw
from sports_science.clinical import gameplan_response
from sports_science.skill_bridge import _metric_result


def test_run_metrics_derived_output_is_not_e1():
    out = compute_metrics_from_raw({
        "performance": {"fg": 50.0, "tp": 0.0, "ast": 2.0, "oreb": 3.0,
                        "tov": -2.0, "pf": -3.0, "defensive_attention": 0.6,
                        "court_spacing": 0.0},
        "biometrics": {"hrv": 65.0, "load": 0.7, "acute_chronic": 1.0, "sleep_hrs": 7.0},
    })
    assert out["evidence_tier"] != "E1"


def test_gameplan_rule_based_is_not_e1():
    plan = gameplan_response({"ter": 1.0, "gravity": 0.5, "flow": 0.5, "fatigue": 20,
                              "injury_risk": 10, "acute_chronic": 1.0})
    assert plan["evidence_tier"] != "E1"


def test_skill_bridge_missing_dataset_is_e4():
    res = _metric_result({"dataset": "C:/definitely/missing.json"}, None)
    assert res["success"] is False
    assert res["evidence_tier"] == "E4"


def test_run_experiment_tier_not_gated_on_profit():
    from sports_science.run_experiment import _metrics
    metrics = _metrics([
        type("R", (), {"name": "m", "roi": 0.01, "concordance": 0.56, "ci_low": 0.51,
                       "ci_high": 0.61, "brier": 0.24, "calibration_error": 0.02,
                       "gap": 0.03, "gap_p_positive": 0.7, "roi_p_positive": 0.4,
                       "bets": 900, "n": 1200, "verdict": ""})()
    ])
    assert metrics[0]["evidence_tier"] == "E2"
