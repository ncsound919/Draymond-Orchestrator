# sports_science/tests/test_evidence.py
"""Tests for evidence.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sports_science.evidence import grade_metric, grade_profile  # noqa: E402


def test_grade_measured():
    assert grade_metric("ter", 1.2, "measured") == "E1"
    assert grade_metric("ter", 1.2, "sensor") == "E1"


def test_grade_derived():
    assert grade_metric("ter", 1.2, "derived") == "E2"
    assert grade_metric("ter", 1.2, "model") == "E2"


def test_grade_rule_based():
    assert grade_metric("ter", 1.2, "rule-based") == "E3"


def test_grade_simulated():
    assert grade_metric("ter", 1.2, "simulation") == "E4"


def test_grade_fallback():
    assert grade_metric("ter", 1.2) == "E2"


def test_grade_profile_nested():
    out = grade_profile({"ter": {"evidence_tier": "E1"}, "form": {"evidence_tier": "E3"}})
    assert out["evidence_tier"] == "E1"
