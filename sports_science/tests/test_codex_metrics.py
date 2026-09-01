# sports_science/tests/test_codex_metrics.py
import sports_science.codex_metrics as cm
from sports_science.codex_metrics import (
    ter_score,
    four_factors,
    four_factors_from_performance,
    gravity_index,
    flow_index,
    FOUR_FACTOR_NAMES,
)


def test_ter_score_aggression():
    high = ter_score(fg=85.0, tp=92.0, ast=55.0, oreb=65.0, tov=-68.0, pf=-78.0, cell_cycle=24.0)
    low = ter_score(fg=45.0, tp=28.0, ast=72.0, oreb=42.0, tov=-22.0, pf=-18.0, cell_cycle=24.0)
    assert high > low


def test_four_factors_returns_four_named_values():
    res = four_factors(proliferation=88.0, clearance=60.0, resource=50.0, metastasis=30.0)
    assert set(res.keys()) == set(FOUR_FACTOR_NAMES)


def test_gravity_and_flow_bounds():
    assert 0.0 <= gravity_index(defensive_attention=0.8, court_spacing=0.5) <= 1.0
    assert flow_index(tempo=0.6, possession_quality=0.9) >= 0.0


def test_ter_score_uses_authoritative_formula():
    """The in-module TER formula is the authoritative reference (bbtech import is dead code)."""
    assert ter_score(85.0, 92.0, 55.0, 65.0, -68.0, -78.0, 24.0) == 23.76125
    assert ter_score(85.0, 92.0, 55.0, 65.0, -68.0, -78.0, 0.0) == 0.0


def test_four_factors_clearance_formula_direct():
    res = four_factors(88, 60, 50, 30)
    assert res["clearance"] == 37.5


def test_four_factors_from_performance_real_values():
    p = {"fg": 85.0, "tp": 92.0, "ast": 55.0, "oreb": 65.0, "tov": -68.0, "pf": -78.0,
         "defensive_attention": 0.8, "court_spacing": 0.6}
    res = four_factors_from_performance(p)
    assert set(res.keys()) == set(FOUR_FACTOR_NAMES)
    assert all(0.0 <= v <= 100.0 for v in res.values())
    # High shooting drives high proliferation; high errors drive metastasis.
    assert res["proliferation"] > res["metastasis"]


def test_four_factors_from_performance_monotonic_in_shooting():
    high = four_factors_from_performance({"fg": 90.0, "tp": 60.0, "tov": -1.0, "pf": -1.0})
    low = four_factors_from_performance({"fg": 20.0, "tp": 0.0, "tov": -5.0, "pf": -5.0})
    assert low["proliferation"] < high["proliferation"]
