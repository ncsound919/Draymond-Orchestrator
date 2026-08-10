# biotech_science/tests/test_onco_metrics.py
"""Tests for onco_metrics.py — mirrors test_codex_metrics.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from biotech_science.onco_metrics import (  # noqa: E402
    compute_onco_metrics,
    four_factors,
    ter_score,
    tumor_flow,
    tumor_gravity,
)


def test_ter_positive_events_score_positive():
    assert ter_score(10, 3, 5, 4, 0, 0, cell_cycle=24) > 0


def test_ter_liabilities_reduce_score():
    high = ter_score(10, 3, 5, 4, 0, 0, cell_cycle=24)
    low = ter_score(10, 3, 5, 4, 8, 8, cell_cycle=24)
    assert low < high


def test_ter_zero_cell_cycle_returns_zero():
    assert ter_score(10, 3, 5, 4, 1, 1, cell_cycle=0) == 0.0


def test_four_factors_clamped_and_ordered():
    factors = four_factors(150, -10, 80, 50)
    assert set(factors.keys()) == {"proliferation", "clearance", "angiogenesis", "metastasis"}
    assert 0 <= factors["proliferation"] <= 100
    assert 0 <= factors["clearance"] <= 100


def test_gravity_and_flow_bounds():
    assert 0 <= tumor_gravity(1, 1) <= 1
    assert tumor_flow(0.5, 0.5) >= 0


def test_compute_onco_metrics_shape():
    m = compute_onco_metrics(60, 40, 30, 20, fg=5, tp=2, ast=3, oreb=2, tov=1, pf=1)
    assert "ter" in m and "four_factors" in m and "evidence_tier" in m
    assert m["evidence_tier"] == "E1"
