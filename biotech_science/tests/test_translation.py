# biotech_science/tests/test_translation.py
"""Tests for the bidirectional translation engine."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from biotech_science.translation.engine import BiotechTranslationEngine  # noqa: E402


def test_forward_term_translation():
    out = BiotechTranslationEngine().translate("player")
    assert out["target_term"] == "cell"
    assert out["direction"] == "basketball_to_biotech"
    assert out["confidence"] > 0.5


def test_reverse_translation():
    out = BiotechTranslationEngine().translate("cell", from_sports=False)
    assert out["target_term"] == "player"
    assert out["direction"] == "biotech_to_basketball"


def test_archetype_translation_jordan_is_cancer():
    out = BiotechTranslationEngine().translate("jordan")
    assert out["target_term"] == "cancer_dominant"
    assert out["archetype"] == "malignant"


def test_archetype_translation_curry_is_viral():
    out = BiotechTranslationEngine().translate("curry")
    assert out["target_term"] == "virus_like_spread"


def test_unknown_term_literal_and_e4():
    out = BiotechTranslationEngine().translate("nonexistent_term_xyz")
    assert out["evidence_tier"] == "E4"
    assert out["target_term"] == "nonexistent_term_xyz"


def test_metric_conversion_attached():
    out = BiotechTranslationEngine().translate("ter")
    assert "metric_conversion" in out
    assert out["metric_conversion"]["biotech_metric"] == "tumor_efficiency"


def test_evidence_tier_assigned():
    out = BiotechTranslationEngine().translate("coach")
    assert out["evidence_tier"] in ("E1", "E2", "E3", "E4")
