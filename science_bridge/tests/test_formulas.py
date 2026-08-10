# science_bridge/tests/test_formulas.py
"""Tests for the math-x / SymPy NBA advanced-stat formula engine."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from science_bridge.formulas import compute_box_score, list_formulas, verify_formula  # noqa: E402

BOX = {
    "FG": 10, "FGA": 18, "3P": 3, "3PA": 6, "FT": 5, "FTA": 6,
    "OREB": 2, "DREB": 6, "REB": 8, "AST": 6, "STL": 1, "BLK": 1,
    "TOV": 2, "PF": 2, "PTS": 28, "MP": 36, "G": 1,
}


def test_list_formulas():
    assert "PER" in list_formulas()
    assert "TS_PCT" in list_formulas()
    assert "EFG_PCT" in list_formulas()


def test_compute_per():
    results = compute_box_score(BOX)
    per = next(r for r in results if r["key"] == "PER")
    assert per["value"] is not None
    assert per["biotech_analog"] == "Viability-Efficiency Composite"
    assert per["evidence_tier"] in ("E1", "E2", "E3", "E4")


def test_compute_ts_pct():
    results = compute_box_score(BOX)
    ts = next(r for r in results if r["key"] == "TS_PCT")
    # TS% = PTS / (2*(FGA + 0.44*FTA)) = 28 / (2*(18+2.64)) = 28/41.28 ~ 0.678
    assert 0.6 < ts["value"] < 0.75
    assert ts["biotech_value"] == ts["value"]  # analog preserves the ratio


def test_compute_efg():
    results = compute_box_score(BOX)
    efg = next(r for r in results if r["key"] == "EFG_PCT")
    # eFG% = (FG + 0.5*3P)/FGA = (10+1.5)/18 ~ 0.639
    assert 0.6 < efg["value"] < 0.7


def test_all_results_have_tiers():
    for r in compute_box_score(BOX):
        assert "evidence_tier" in r
        assert "biotech_analog" in r


def test_verify_formula_contract():
    from science_bridge.formulas import FORMULAS
    verdict = verify_formula(FORMULAS[0])  # PER
    assert "verified" in verdict
    assert "trust_score" in verdict
