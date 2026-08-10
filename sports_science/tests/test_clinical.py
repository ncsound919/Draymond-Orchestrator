# sports_science/tests/test_clinical.py
"""Tests for clinical.py — sports performance-risk module."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sports_science.clinical import (  # noqa: E402
    availability_tier,
    baseline_form,
    fatigue_curve,
    gameplan_response,
    projected_availability,
)


def test_baseline_form_bounds():
    assert 0 <= baseline_form(1.2, 0.6, 0.5) <= 1
    assert baseline_form(0, 0, 0) == 0
    assert baseline_form(2.0, 1.0, 1.0) == 1.0


def test_projected_availability_bounds():
    assert 0 <= projected_availability(0, 0, 1.0) <= 1
    low = projected_availability(100, 1.0, 0.1)
    assert low < projected_availability(0, 0, 1.0)


def test_fatigue_curve_shape():
    curve = fatigue_curve([50, 60, 55, 70, 65])
    assert len(curve) == 5
    assert set(curve[0].keys()) == {"day", "load", "decayed_load", "fatigue_index"}
    assert 0 <= curve[0]["fatigue_index"] <= 1


def test_availability_tier():
    assert availability_tier(0.9) == "critical"
    assert availability_tier(0.7) == "elevated"
    assert availability_tier(0.5) == "normal"


def test_gameplan_response_contract():
    out = gameplan_response({"fatigue": 40, "injury_risk": 0.3, "availability": 0.9, "form": 0.8})
    assert out["status"] == "ok"
    assert out["availability_tier"] == "normal"
    assert "recommendation" in out
    assert "minutes" in out
