# science_bridge/tests/test_strategy_procedure.py
"""Tests for the strategy + procedure translation layers."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from science_bridge.procedure import list_procedures, translate_procedure  # noqa: E402
from science_bridge.strategy import list_strategies, translate_strategy  # noqa: E402
from science_bridge.translation.engine import TranslationEngine  # noqa: E402


def test_strategy_forward():
    out = translate_strategy("small-ball lineup")
    assert out["layer"] == "strategy"
    assert out["target_term"] == "low-density tumor microenvironment strategy"
    assert out["confidence"] > 0.5
    assert out["tactics"]


def test_strategy_unknown():
    out = translate_strategy("bogus strategy xyz")
    assert out["target_term"] is None
    assert out["evidence_tier"] == "E4"


def test_procedure_forward():
    out = translate_procedure("pick-and-roll")
    assert out["layer"] == "procedure"
    assert "combination pulse" in out["target_term"]
    assert out["sequence"]


def test_procedure_unknown():
    out = translate_procedure("bogus procedure xyz")
    assert out["target_term"] is None


def test_list_strategies_and_procedures():
    assert len(list_strategies()) >= 5
    assert len(list_procedures()) >= 5


def test_layered_walk_via_engine():
    engine = TranslationEngine()
    # terminology
    t = engine.translate_layer("player")
    assert t["layer"] == "terminology" and t["target_term"] == "cell"
    # strategy
    s = engine.translate_layer("switch-everything defense")
    assert s["layer"] == "strategy"
    # procedure
    p = engine.translate_layer("call timeout")
    assert p["layer"] == "procedure"
    # unknown falls through
    u = engine.translate_layer("does-not-exist-xyz")
    assert u["target_term"] is None
    assert u["evidence_tier"] == "E4"
