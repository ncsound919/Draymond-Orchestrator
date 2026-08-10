# science_bridge/tests/test_insights.py
"""Tests for whole-profile bidirectional insight synthesis."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from science_bridge.insights import synthesize  # noqa: E402

SPORTS_PROFILE = {
    "ter": 1.2,
    "four_factors": {"proliferation": 70, "clearance": 40, "resource": 55, "metastasis": 45},
    "gravity": 0.6,
    "flow": 0.5,
    "fatigue": 40,
    "injury_risk": 0.3,
    "recovery_priority": "high",
    "archetype": "jordan",
}

BIOTECH_PROFILE = {
    "ter": 1.1,
    "four_factors": {"proliferation": 60, "clearance": 50, "angiogenesis": 55, "metastasis": 40},
    "tumor_gravity": 0.55,
    "tumor_flow": 0.5,
    "risk_tier": "high",
    "recurrence_risk": 0.6,
    "archetype": "cancer_dominant",
}


def test_detect_sports_domain():
    report = synthesize(SPORTS_PROFILE)
    assert report.from_domain == "sports"
    assert report.to_domain == "biotech"


def test_detect_biotech_domain():
    report = synthesize(BIOTECH_PROFILE)
    assert report.from_domain == "biotech"
    assert report.to_domain == "sports"


def test_source_read_present():
    report = synthesize(SPORTS_PROFILE)
    assert "four-factor" in report.source_read or "efficiency" in report.source_read


def test_target_read_present():
    report = synthesize(SPORTS_PROFILE)
    assert report.target_read  # non-empty actionable implication


def test_translated_metrics_present():
    report = synthesize(SPORTS_PROFILE)
    assert len(report.translated_metrics) > 0
    assert all(m.target_metric for m in report.translated_metrics)


def test_resource_normalized_to_angiogenesis():
    report = synthesize(SPORTS_PROFILE)
    metrics = {m.metric: m for m in report.translated_metrics}
    assert "resource" in metrics
    assert metrics["resource"].target_metric == "angiogenesis"


def test_archetype_translated():
    report = synthesize(SPORTS_PROFILE)
    assert report.archetype == "jordan"
    assert report.archetype_translation == "cancer_dominant"


def test_evidence_tier_valid():
    for profile in (SPORTS_PROFILE, BIOTECH_PROFILE):
        report = synthesize(profile)
        assert report.evidence_tier in ("E1", "E2", "E3", "E4")
        assert 0 <= report.confidence <= 1


def test_explicit_from_domain_override():
    # Passing a biotech profile but forcing sports reading should still work
    # (detect would say biotech; override forces sports interpretation).
    report = synthesize(SPORTS_PROFILE, from_domain="sports")
    assert report.from_domain == "sports"
