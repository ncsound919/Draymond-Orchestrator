# sports_science/tests/test_codex_metrics.py
import sports_science.codex_metrics as cm
from sports_science.codex_metrics import (
    ter_score,
    four_factors,
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


def test_ter_score_fallback_matches_bbtech_formula(monkeypatch):
    monkeypatch.setattr(cm, "_BBTECH_AVAILABLE", False)
    assert cm.ter_score(85.0, 92.0, 55.0, 65.0, -68.0, -78.0, 24.0) == 23.76125


def test_ter_score_zero_cell_cycle_returns_zero(monkeypatch):
    monkeypatch.setattr(cm, "_BBTECH_AVAILABLE", False)
    assert cm.ter_score(85.0, 92.0, 55.0, 65.0, -68.0, -78.0, 0.0) == 0.0


def test_four_factors_clearance_parity(monkeypatch):
    live = cm.four_factors(88, 60, 50, 30)
    monkeypatch.setattr(cm, "_BBTECH_AVAILABLE", False)
    fallback = cm.four_factors(88, 60, 50, 30)
    assert fallback["clearance"] == 37.5
    assert fallback["clearance"] == live["clearance"]
