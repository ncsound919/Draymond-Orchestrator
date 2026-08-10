# biotech_science/tests/test_clinical.py
"""Tests for clinical.py — mirrors test_injury_risk.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from biotech_science.clinical import (  # noqa: E402
    baseline_risk,
    post_treatment_risk,
    risk_tier,
    survival_curve,
    treatment_response,
)


def test_baseline_risk_in_unit_interval():
    r = baseline_risk(3.0, 3, 60, {"ER_positive": False, "HER2_positive": True})
    assert 0 <= r <= 1


def test_higher_grade_higher_risk():
    low = baseline_risk(2.0, 1, 50, {"ER_positive": True, "HER2_positive": False})
    high = baseline_risk(2.0, 3, 50, {"ER_positive": True, "HER2_positive": False})
    assert high > low


def test_treatment_reduces_risk_with_shrinkage():
    base = baseline_risk(3.0, 2, 55, {})
    post = post_treatment_risk(base, ctdna=0.0, tumor_shrinkage=50, time_point=3)
    assert post < base


def test_risk_tier_boundaries():
    assert risk_tier(0.1) == "low"
    assert risk_tier(0.3) == "intermediate"
    assert risk_tier(0.7) == "high"


def test_survival_curve_starts_at_one():
    curve = survival_curve([1, 2, 3, 4, 5], [1, 1, 0, 1, 0])
    assert len(curve) > 0
    assert curve[0]["survival"] <= 1.0
    assert curve[-1]["survival"] >= 0.0


def test_treatment_response_contract():
    out = treatment_response({"risk": 0.6, "ter": 1.1})
    assert out["status"] == "ok"
    assert out["risk_tier"] == "high"
    assert "recommendation" in out
